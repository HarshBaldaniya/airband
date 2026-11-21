// The phone link: the Station's own connection out to Airband's relay, so a linked phone can see what
// needs you and answer from anywhere. Everything the phone receives is locked with the pair's key
// (see remote/box.ts); the relay only passes it along. Notifications go from this computer straight
// to the phone's push service, locked for that phone. A phone can answer a request and set a
// finished chat aside. It cannot ask, message a chat, open anything or change a setting.
import { webcrypto } from "node:crypto";
import { airbandFile, readJson, writeFileAtomic } from "../core/paths";
import { openBox, pairingFragment, randomB64u, seal, unseal, type Box, type ComputerMessage, type PhoneMessage, type RelayFrame } from "../remote/box";
import { isPushEndpoint, newVapidKeys, sendPush, type PushTarget, type VapidKeys } from "../remote/webpush";
import type { Answer } from "./reply";
import type { FinishedView, PendingView, Station, StationState } from "./server";

if (!globalThis.crypto) (globalThis as { crypto?: unknown }).crypto = webcrypto;

/** Airband's relay. `AIRBAND_RELAY_URL` points at another one (a test, or your own). */
export const RELAY_URL = (process.env.AIRBAND_RELAY_URL ?? "https://app.airband.workers.dev").replace(/\/+$/, "");

export interface LinkedPhone {
  id: string;
  name: string;
  push: PushTarget;
  at: number;
}

interface LinkFile {
  room: string;
  secret: string;
  vapid: VapidKeys;
  phones: LinkedPhone[];
}

export interface LinkStatus {
  linked: boolean;
  /** The relay is reachable now. */
  online: boolean;
  phones: { name: string; at: number }[];
}

/** What one phone's push service said to a notification, in words for the person. */
export interface PushReport {
  name: string;
  ok: boolean;
  status: number;
  why?: string;
}

function why(status: number): string | undefined {
  if (status >= 200 && status < 300) return undefined;
  if (status === 404 || status === 410) return "This phone turned its alerts off. Open Airband on it and tap Turn on alerts.";
  if (status === 401 || status === 403) return "The push service refused this computer's signature. Link the phone again.";
  if (status === 413) return "The alert was too long.";
  if (status === 429) return "Too many alerts at once. Try again in a minute.";
  if (status === 0) return "Couldn't reach the phone's push service. Is this computer online?";
  return `The push service said ${status}.`;
}

export interface PhoneLinkOptions {
  relay?: string;
  /** The person is away from the computer (screen locked, idle): only then does the phone buzz. */
  away?: () => boolean;
  WebSocket?: typeof WebSocket;
  fetch?: typeof fetch;
  now?: () => number;
  /** How long a request waits on the computer before the phone is told, if the person is at it. */
  nudgeMs?: number;
}

const linkFile = () => airbandFile("phone-link.json");
const MAX_CHATS = 30;
const DECISIONS = new Set(["allow", "always", "deny", "terminal"]);

export class PhoneLink {
  private file?: LinkFile;
  private box?: Box;
  private ws?: WebSocket;
  private online = false;
  private stopped = false;
  private retryMs = 1000;
  private retry?: NodeJS.Timeout;
  private ping?: NodeJS.Timeout;
  private lastSent = "";
  private sendTimer?: NodeJS.Timeout;
  private nudges = new Map<string, NodeJS.Timeout>();
  private readonly relay: string;

  constructor(
    private readonly station: Station,
    private readonly o: PhoneLinkOptions = {},
  ) {
    this.relay = (o.relay ?? RELAY_URL).replace(/\/+$/, "");
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  private get WS(): typeof WebSocket | undefined {
    return this.o.WebSocket ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.station.on("change", this.onChange);
    this.station.on("request", this.onRequest);
    this.station.on("finished", this.onFinished);
    this.file = readJson<LinkFile | undefined>(linkFile(), undefined);
    if (this.file?.room && this.file.secret) {
      this.box = await openBox(this.file.secret);
      this.connect();
    }
  }

  stop(): void {
    this.stopped = true;
    this.station.off("change", this.onChange);
    this.station.off("request", this.onRequest);
    this.station.off("finished", this.onFinished);
    this.disconnect();
    for (const t of this.nudges.values()) clearTimeout(t);
    this.nudges.clear();
  }

  status(): LinkStatus {
    return { linked: !!this.file, online: this.online, phones: (this.file?.phones ?? []).map((p) => ({ name: p.name, at: p.at })) };
  }

  /** A new pairing: a new room and secret (any phone linked before is unlinked). The link to show as a code. */
  async link(): Promise<string> {
    await this.forgetRoom();
    this.file = { room: randomB64u(16), secret: randomB64u(32), vapid: this.file?.vapid ?? newVapidKeys(), phones: [] };
    this.save();
    this.box = await openBox(this.file.secret);
    this.disconnect();
    this.connect();
    this.station.changed();
    return this.pairingUrl()!;
  }

  pairingUrl(): string | undefined {
    if (!this.file) return undefined;
    return `${this.relay}/#${pairingFragment({ room: this.file.room, secret: this.file.secret, vapid: this.file.vapid.publicKey })}`;
  }

  /** Unlinks every phone: the room is deleted on the relay, and the secret here. */
  async unlink(): Promise<void> {
    await this.forgetRoom();
    this.disconnect();
    this.file = undefined;
    this.box = undefined;
    writeFileAtomic(linkFile(), "null");
    this.station.changed();
  }

  private save(): void {
    writeFileAtomic(linkFile(), JSON.stringify(this.file));
  }

  private async forgetRoom(): Promise<void> {
    if (!this.file || !this.box) return;
    try {
      await (this.o.fetch ?? fetch)(`${this.relay}/r/${this.file.room}/forget`, { method: "POST", headers: { "x-room-token": this.box.token }, signal: AbortSignal.timeout(5000) });
    } catch {
      // Offline: the relay deletes an unused room by itself after 30 days.
    }
  }

  // ---- the connection to the relay ----

  private connect(): void {
    const WS = this.WS;
    if (this.stopped || !WS || !this.file || !this.box) return;
    const url = `${this.relay.replace(/^http/, "ws")}/r/${this.file.room}/ws?role=mac&token=${encodeURIComponent(this.box.token)}`;
    let ws: WebSocket;
    try {
      ws = new WS(url);
    } catch {
      return this.later();
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.online = true;
      this.retryMs = 1000;
      this.lastSent = "";
      this.sendState();
      clearInterval(this.ping);
      this.ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), 45_000);
      this.station.changed();
    });
    ws.addEventListener("message", (e) => void this.received(String((e as MessageEvent).data)));
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.online = false;
      clearInterval(this.ping);
      this.later();
    });
    ws.addEventListener("error", () => undefined);
  }

  private later(): void {
    if (this.stopped || !this.file) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 60_000);
  }

  private disconnect(): void {
    clearTimeout(this.retry);
    clearInterval(this.ping);
    clearTimeout(this.sendTimer);
    const ws = this.ws;
    this.ws = undefined;
    this.online = false;
    try {
      ws?.close();
    } catch {
      // Already closed.
    }
  }

  private frame(f: RelayFrame): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(f));
  }

  private async tell(m: ComputerMessage, kind: "state" | "msg" = "msg"): Promise<void> {
    if (!this.box) return;
    this.frame({ k: kind, d: await seal(this.box, m, this.now()) });
  }

  // ---- what the phone sees ----

  /** The state, cut to what a phone shows: no settings beyond the companion, no phone address. */
  private phoneState(s: StationState = this.station.snapshot()): unknown {
    const { phoneUrl: _u, link: _l, ...rest } = s;
    return { ...rest, chats: s.chats.slice(0, MAX_CHATS), settings: { companion: s.settings.companion } };
  }

  private sendState(): void {
    clearTimeout(this.sendTimer);
    this.sendTimer = setTimeout(() => {
      const state = this.phoneState();
      const key = JSON.stringify({ ...(state as object), now: 0 });
      if (key === this.lastSent) return;
      this.lastSent = key;
      void this.tell({ t: "state", state }, "state");
    }, 300);
  }

  private onChange = () => {
    if (this.online) this.sendState();
  };

  // ---- what the phone says ----

  private async received(raw: string): Promise<void> {
    if (raw === "pong" || !this.box) return;
    let f: RelayFrame;
    try {
      f = JSON.parse(raw) as RelayFrame;
    } catch {
      return;
    }
    if (f.k !== "msg") return;
    const m = await unseal<PhoneMessage>(this.box, f.d, this.now());
    if (!m || typeof m !== "object") return;
    switch (m.t) {
      case "hello":
        this.lastSent = "";
        return this.sendState();
      case "decide": {
        if (!DECISIONS.has(m.decision) || typeof m.id !== "string") return;
        const answer: Answer = { decision: m.decision, ...(m.answers && typeof m.answers === "object" ? { answers: m.answers as Answer["answers"] } : {}), ...(typeof m.message === "string" ? { message: m.message.slice(0, 500) } : {}) };
        const ok = this.station.decide(m.id, answer, "phone");
        return this.tell({ t: "reply", n: m.n, ok, ...(ok ? {} : { error: "That request has already ended." }) });
      }
      case "dismiss":
        if (typeof m.chatId === "string") this.station.dismiss(m.chatId);
        return this.tell({ t: "reply", n: m.n, ok: true });
      case "subscribe": {
        const sub = m.sub;
        if (!this.file || typeof m.id !== "string" || !sub || !isPushEndpoint(sub.endpoint) || typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string") return this.tell({ t: "reply", n: m.n, ok: false, error: "That phone can't take alerts." });
        const name = String(m.name ?? "Phone").slice(0, 40);
        this.file.phones = [...this.file.phones.filter((p) => p.id !== m.id), { id: m.id.slice(0, 40), name, push: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, at: this.now() }].slice(-4);
        this.save();
        this.station.changed();
        await this.tell({ t: "reply", n: m.n, ok: true });
        return void this.push([this.file.phones.at(-1)!], { title: "Alerts are on", body: "Your phone buzzes when a chat needs you and you're away from your computer.", tag: "hello" });
      }
      case "test": {
        const results = await this.push(this.file?.phones ?? [], { title: "Test from your computer", body: "Alerts work. Tap to open Airband.", tag: "test", kind: "done" });
        const failed = results.find((r) => !r.ok);
        if (!results.length) return this.tell({ t: "reply", n: m.n, ok: false, error: "Alerts aren't on for this phone yet. Tap Turn on alerts." });
        return this.tell({ t: "reply", n: m.n, ok: !failed, ...(failed ? { error: failed.why ?? "It didn't go through." } : {}) });
      }
      case "forget":
        if (!this.file || typeof m.id !== "string") return;
        this.file.phones = this.file.phones.filter((p) => p.id !== m.id);
        this.save();
        this.station.changed();
        return;
    }
  }

  // ---- notifications ----

  private away(): boolean {
    return this.o.away?.() ?? true;
  }

  /** Test in the settings: a pretend request, sent to every phone at once, wherever you are. */
  async sample(): Promise<PushReport[]> {
    const p = this.station.sample();
    return this.push(this.file?.phones ?? [], { title: "Airband test", body: "A test from your computer. Tap Allow or Deny. Nothing runs.", tag: p.id, id: p.id, kind: "request" });
  }

  private onRequest = (p: PendingView) => {
    if (!this.file?.phones.length || p.sample) return;
    const tell = () => {
      this.nudges.delete(p.id);
      if (!this.station.snapshot().pending.some((x) => x.id === p.id)) return;
      // A question or a plan is answered in the app; a plain request can be answered on the notice itself.
      const kind = p.questions?.length || p.toolName === "ExitPlanMode" ? "question" : "request";
      void this.push(this.file?.phones ?? [], { title: `${p.chatTitle} needs you`, body: p.detail ? `${p.title}: ${p.detail}` : p.title, tag: p.id, id: p.id, kind });
    };
    if (this.away()) return tell();
    // At the computer: the phone is told only if the request is still waiting a little later.
    this.nudges.set(p.id, setTimeout(() => (this.away() ? tell() : this.nudges.delete(p.id)), this.o.nudgeMs ?? 45_000));
  };

  private onFinished = (f: FinishedView) => {
    if (!this.file?.phones.length || !this.away()) return;
    void this.push(this.file.phones, { title: `${f.title} finished`, body: f.did ?? "Have a look when you're back.", tag: `done-${f.chatId}`, kind: "done" });
  };

  private async push(phones: LinkedPhone[], note: { title: string; body: string; tag: string; id?: string; kind?: string }): Promise<PushReport[]> {
    if (!this.file) return [];
    const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    const payload = { ...note, title: clip(note.title, 80), body: clip(note.body, 240) };
    const gone: string[] = [];
    const reports = await Promise.all(
      phones.map(async (p): Promise<PushReport> => {
        try {
          const r = await sendPush(p.push, payload, this.file!.vapid, { topic: note.tag, ...(this.o.fetch ? { fetch: this.o.fetch } : {}) });
          if (r.gone) gone.push(p.id);
          const w = why(r.status);
          return { name: p.name, ok: !w, status: r.status, ...(w ? { why: w } : {}) };
        } catch {
          // Offline: the request is still on the computer, and on the phone when it opens.
          return { name: p.name, ok: false, status: 0, why: why(0) };
        }
      }),
    );
    if (gone.length && this.file) {
      this.file.phones = this.file.phones.filter((p) => !gone.includes(p.id));
      this.save();
      this.station.changed();
    }
    return reports;
  }
}
