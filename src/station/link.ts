// The phone link: your Mac and your iPhone, and no one else. The Station keeps its own connection out
// to Airband's relay, so the linked iPhone sees what needs you and answers from anywhere.
//
// Who can link, and how:
//   - Only a Mac offers it, and only an iPhone takes it: alerts go only through Apple's push service.
//   - Link shows a code that works once, for 10 minutes. The first iPhone to use it "claims" it and
//     gets a room and a secret of its own; the code is deleted on the relay at once, so a photo of it
//     is worth nothing. One iPhone per Mac: another needs Unlink, then a new code.
//   - Everything between the two is locked with that secret (remote/box.ts). The relay passes it along
//     and can read none of it. Alerts go from this Mac straight to Apple, locked for that iPhone.
//   - The iPhone can answer a request and set a finished chat aside. It cannot ask, message a chat,
//     open anything or change a setting.
//
// Free, and kept that way: the Mac sends its state only while the iPhone app is open, at most once a
// second, and at most DAILY_FRAMES frames a day; a quiet link costs a keep-alive a minute. Cloudflare's
// free plan never charges: past its daily limit the relay just stops until the next day.
import { webcrypto } from "node:crypto";
import { airbandFile, readJson, writeFileAtomic } from "../core/paths";
import { openBox, pairingFragment, randomB64u, seal, sealForClaim, unseal, type Box, type ClaimedRoom, type ComputerMessage, type PhoneMessage, type RelayFrame } from "../remote/box";
import { isPushEndpoint, newVapidKeys, sendPush, type PushTarget, type VapidKeys } from "../remote/webpush";
import type { Answer } from "./reply";
import type { LiveChat } from "./chats";
import type { FinishedView, PendingView, Station, StationState } from "./server";

if (!globalThis.crypto) (globalThis as { crypto?: unknown }).crypto = webcrypto;

/** Airband's relay. `AIRBAND_RELAY_URL` points at another one (a test, or your own). */
export const RELAY_URL = (process.env.AIRBAND_RELAY_URL ?? "https://app.airband.workers.dev").replace(/\/+$/, "");

/** How long a code waits to be scanned. */
export const CODE_MS = 10 * 60_000;
/** The most frames the Mac sends the relay in a day, whatever happens: far inside the free plan. */
export const DAILY_FRAMES = 3000;
const PING_MS = 60_000;
const MAX_RETRY_MS = 5 * 60_000;
const STATE_EVERY_MS = 1000;
const MAX_CHATS = 30;
const DECISIONS = new Set(["allow", "always", "deny", "terminal"]);
/** A claim with no key of its own comes from a copy of the iPhone app older than the locked handover. */
const OLD_PHONE_APP = "This iPhone has an older copy of Airband. Close it, open it again, and scan a new code.";
/** The longest title and body an alert carries. The Lock Screen shows the first lines, a long press the rest. */
const ALERT_TITLE_MAX = 90;
const ALERT_BODY_MAX = 360;

export interface LinkedPhone {
  id: string;
  name: string;
  /** Where its alerts go; missing until the iPhone turns alerts on. */
  push?: PushTarget;
  at: number;
}

interface LinkFile {
  room: string;
  secret: string;
  vapid: VapidKeys;
  /** The one iPhone, once it claimed the code. */
  phone?: LinkedPhone;
  /** While set, room and secret are a code waiting to be scanned, until this time. */
  codeUntil?: number;
}

export interface LinkStatus {
  /** An iPhone holds the link. */
  linked: boolean;
  /** A code is showing, waiting for an iPhone to scan it, until this time. */
  codeUntil?: number;
  /** The last code ran out before anyone scanned it. */
  expired?: boolean;
  /** The relay is reachable now. */
  online: boolean;
  phones: { name: string; at: number; alerts: boolean }[];
}

/** What Apple's push service said to an alert, in words for the person. */
export interface PushReport {
  name: string;
  ok: boolean;
  status: number;
  why?: string;
}

function why(status: number): string | undefined {
  if (status >= 200 && status < 300) return undefined;
  if (status === 404 || status === 410) return "This iPhone turned its alerts off. Open Airband on it and tap Turn on alerts.";
  if (status === 401 || status === 403) return "Apple refused this Mac's signature. Link the iPhone again.";
  if (status === 413) return "The alert was too long.";
  if (status === 429) return "Too many alerts at once. Try again in a minute.";
  if (status === 0) return "Couldn't reach Apple's push service. Is this Mac online?";
  return `Apple's push service said ${status}.`;
}

export interface PhoneLinkOptions {
  relay?: string;
  /** The person is away from the computer (screen locked, idle). */
  away?: () => boolean;
  WebSocket?: typeof WebSocket;
  fetch?: typeof fetch;
  now?: () => number;
  /** How long a request waits on the computer before the iPhone is told, when alerts are "only when away". */
  nudgeMs?: number;
  /** How long the claiming iPhone has to read its new secret before the code's room is deleted. */
  handoverMs?: number;
}

const linkFile = () => airbandFile("phone-link.json");

/** The chats as the iPhone sees them: no folder paths. */
function forPhone(c: LiveChat): Omit<LiveChat, "cwd" | "open"> {
  const { cwd: _c, open: _o, ...rest } = c;
  return rest;
}

export class PhoneLink {
  private file?: LinkFile;
  private box?: Box;
  private ws?: WebSocket;
  private online = false;
  private stopped = false;
  private expired = false;
  private retryMs = 1000;
  private retry?: NodeJS.Timeout;
  private ping?: NodeJS.Timeout;
  private codeTimer?: NodeJS.Timeout;
  private lastSent = "";
  private lastSentAt = 0;
  private sendTimer?: NodeJS.Timeout;
  /** iPhone app connections open now, as the relay counts them. */
  private watching = 0;
  private budget = { day: "", n: 0 };
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
    const saved = readJson<(LinkFile & { phones?: LinkedPhone[] }) | null>(linkFile(), null);
    if (!saved?.room || !saved.secret || !saved.vapid) return;
    // From the first version, a list of phones: its first one holds the link, as the only iPhone.
    if (saved.phones) {
      if (!saved.phone && saved.phones[0]) saved.phone = saved.phones[0];
      delete saved.phones;
    }
    // A code nobody scanned before the Mac stopped, or a link no iPhone ever took: gone.
    if ((saved.codeUntil && saved.codeUntil <= this.now()) || (!saved.codeUntil && !saved.phone)) {
      void this.forgetRoom(saved.room, await openBox(saved.secret));
      return this.clear();
    }
    this.file = saved;
    this.box = await openBox(saved.secret);
    if (saved.codeUntil) this.expireAt(saved.codeUntil);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.station.off("change", this.onChange);
    this.station.off("request", this.onRequest);
    this.station.off("finished", this.onFinished);
    this.disconnect();
    clearTimeout(this.codeTimer);
    for (const t of this.nudges.values()) clearTimeout(t);
    this.nudges.clear();
  }

  status(): LinkStatus {
    const f = this.file;
    return {
      linked: !!f?.phone,
      ...(f?.codeUntil ? { codeUntil: f.codeUntil } : {}),
      ...(this.expired && !f ? { expired: true } : {}),
      online: this.online,
      phones: f?.phone ? [{ name: f.phone.name, at: f.phone.at, alerts: !!f.phone.push }] : [],
    };
  }

  /** A new code for an iPhone to scan: works once, for 10 minutes. Any iPhone linked before is unlinked. */
  async link(): Promise<string> {
    await this.forgetRoom();
    this.disconnect();
    const now = this.now();
    this.file = { room: randomB64u(16), secret: randomB64u(32), vapid: this.file?.vapid ?? readJson<LinkFile | null>(linkFile(), null)?.vapid ?? newVapidKeys(), codeUntil: now + CODE_MS };
    this.expired = false;
    this.save();
    this.box = await openBox(this.file.secret);
    this.expireAt(this.file.codeUntil!);
    this.connect();
    this.station.changed();
    return this.pairingUrl()!;
  }

  /** The code to show, while one waits to be scanned. */
  pairingUrl(): string | undefined {
    if (!this.file?.codeUntil) return undefined;
    return `${this.relay}/#${pairingFragment({ room: this.file.room, secret: this.file.secret, vapid: this.file.vapid.publicKey })}`;
  }

  /** Ends the link: the room is deleted on the relay, the secret here, and the iPhone sees it at once. */
  async unlink(): Promise<void> {
    await this.forgetRoom();
    this.disconnect();
    this.clear();
    this.station.changed();
  }

  private clear(): void {
    clearTimeout(this.codeTimer);
    this.file = undefined;
    this.box = undefined;
    // The notification key stays: a new link reuses it.
    const vapid = readJson<LinkFile | null>(linkFile(), null)?.vapid;
    writeFileAtomic(linkFile(), JSON.stringify(vapid ? { vapid } : null));
  }

  private expireAt(until: number): void {
    clearTimeout(this.codeTimer);
    this.codeTimer = setTimeout(() => void this.codeRanOut(), Math.max(0, until - this.now()));
  }

  private async codeRanOut(): Promise<void> {
    if (!this.file?.codeUntil) return;
    await this.unlink();
    this.expired = true;
    this.station.changed();
  }

  private save(): void {
    writeFileAtomic(linkFile(), JSON.stringify(this.file));
  }

  private async forgetRoom(room = this.file?.room, box = this.box): Promise<void> {
    if (!room || !box) return;
    try {
      await (this.o.fetch ?? fetch)(`${this.relay}/r/${room}/forget`, { method: "POST", headers: { "x-room-token": box.token }, signal: AbortSignal.timeout(5000) });
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
    this.watching = 0;
    ws.addEventListener("open", () => {
      // A connection let go of before it opened (Unlink, a new code, stop): closed, nothing started.
      if (this.ws !== ws) return void ws.close();
      this.online = true;
      this.retryMs = 1000;
      this.lastSent = "";
      clearInterval(this.ping);
      this.ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), PING_MS);
      this.station.changed();
    });
    ws.addEventListener("message", (e) => void this.received(String((e as MessageEvent).data)));
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.online = false;
      this.watching = 0;
      clearInterval(this.ping);
      this.station.changed();
      this.later();
    });
    ws.addEventListener("error", () => undefined);
  }

  private later(): void {
    if (this.stopped || !this.file) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
  }

  private disconnect(): void {
    clearTimeout(this.retry);
    clearInterval(this.ping);
    clearTimeout(this.sendTimer);
    const ws = this.ws;
    this.ws = undefined;
    this.online = false;
    this.watching = 0;
    try {
      ws?.close();
    } catch {
      // Already closed.
    }
  }

  /** One frame to the relay, inside the day's budget. Answers to the iPhone always go. */
  private frame(f: RelayFrame, essential = false): boolean {
    if (this.ws?.readyState !== 1) return false;
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (this.budget.day !== day) this.budget = { day, n: 0 };
    if (!essential && this.budget.n >= DAILY_FRAMES) return false;
    this.budget.n++;
    this.ws.send(JSON.stringify(f));
    return true;
  }

  private async tell(m: ComputerMessage, kind: "state" | "msg" = "msg", box = this.box): Promise<void> {
    if (!box) return;
    this.frame({ k: kind, d: await seal(box, m, this.now()) }, kind === "msg");
  }

  // ---- what the iPhone sees ----

  /** The state, cut to what an iPhone shows: no folder paths, no settings beyond the companion's. */
  private phoneState(s: StationState = this.station.snapshot()): unknown {
    const { phoneUrl: _u, link: _l, test: _t, ...rest } = s;
    return {
      ...rest,
      chats: s.chats.slice(0, MAX_CHATS).map(forPhone),
      pending: s.pending.map(({ cwd: _c, ...p }) => p),
      settings: { companion: s.settings.companion },
    };
  }

  /** Sends the state when the iPhone app is open and something changed: at most once a second. */
  private sendState(force = false): void {
    if (!this.file?.phone || this.file.codeUntil || (!force && this.watching <= 0)) return;
    clearTimeout(this.sendTimer);
    const wait = Math.max(300, STATE_EVERY_MS - (this.now() - this.lastSentAt));
    this.sendTimer = setTimeout(() => {
      const state = this.phoneState();
      const key = JSON.stringify({ ...(state as object), now: 0 });
      if (key === this.lastSent) return;
      this.lastSent = key;
      this.lastSentAt = this.now();
      void this.tell({ t: "state", state }, "state");
    }, wait);
  }

  private onChange = () => {
    if (this.online) this.sendState();
  };

  // ---- what the iPhone says ----

  private async received(raw: string): Promise<void> {
    if (raw === "pong" || !this.box || !this.file) return;
    let f: RelayFrame;
    try {
      f = JSON.parse(raw) as RelayFrame;
    } catch {
      return;
    }
    if (f.k === "phones") {
      this.watching = Math.max(0, Number(f.n) || 0);
      if (this.watching) this.sendState();
      return;
    }
    if (f.k !== "msg") return;
    const m = await unseal<PhoneMessage>(this.box, f.d, this.now());
    if (!m || typeof m !== "object") return;
    // While a code waits, the only thing heard is a claim: nothing about your chats is sent on a code.
    if (this.file.codeUntil) {
      if (m.t === "claim") await this.claim(m);
      return;
    }
    switch (m.t) {
      case "claim":
        return this.tell({ t: "reply", n: m.n, ok: false, error: "This code was already used. Make a new one on your Mac." });
      case "hello":
        this.lastSent = "";
        return this.sendState(true);
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
        const phone = this.file.phone;
        if (!phone || m.id !== phone.id) return this.tell({ t: "reply", n: m.n, ok: false, error: "This isn't the linked iPhone." });
        if (!sub || !isPushEndpoint(sub.endpoint) || typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string") return this.tell({ t: "reply", n: m.n, ok: false, error: "Airband's alerts work on an iPhone, through Apple's push service." });
        phone.push = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
        this.save();
        this.station.changed();
        await this.tell({ t: "reply", n: m.n, ok: true });
        return void this.push({ title: "Alerts are on", body: "Your iPhone hears when a chat needs you or finishes.", tag: "hello" });
      }
      case "test": {
        const results = await this.push({ title: "Test from your Mac", body: "Alerts work. Tap to open Airband.", tag: "test", kind: "done" });
        const failed = results.find((r) => !r.ok);
        if (!results.length) return this.tell({ t: "reply", n: m.n, ok: false, error: "Alerts aren't on for this iPhone yet. Tap Turn on alerts." });
        return this.tell({ t: "reply", n: m.n, ok: !failed, ...(failed ? { error: failed.why ?? "It didn't go through." } : {}) });
      }
      case "forget":
        // "Unlink this phone" on the iPhone: the link ends on both sides.
        if (m.id === this.file.phone?.id) await this.unlink();
        return;
    }
  }

  /** The first iPhone to send a claim on the code takes the link: a room and secret of its own. */
  private async claim(m: Extract<PhoneMessage, { t: "claim" }>): Promise<void> {
    const f = this.file!;
    const codeBox = this.box!;
    const codeRoom = f.room;
    if (!f.codeUntil || f.codeUntil <= this.now()) return this.tell({ t: "reply", n: m.n, ok: false, error: "This code expired. Make a new one on your Mac." }, "msg", codeBox);
    if (typeof m.id !== "string" || !/^[a-f0-9]{8,40}$/.test(m.id)) return;
    const room = randomB64u(16);
    const secret = randomB64u(32);
    // Locked for the claiming iPhone's own key: anyone else on the code's room hears it and can't open it.
    let handover: { key: string; d: string };
    try {
      if (typeof m.key !== "string") throw new Error("no key");
      handover = await sealForClaim(m.key, { room, secret } satisfies ClaimedRoom, this.now());
    } catch {
      return this.tell({ t: "reply", n: m.n, ok: false, error: OLD_PHONE_APP }, "msg", codeBox);
    }
    const codeWs = this.ws;
    clearTimeout(this.codeTimer);
    // The code's connection is set aside: its close no longer reconnects, and nothing more is heard on it.
    this.ws = undefined;
    clearInterval(this.ping);
    this.file = { room, secret, vapid: f.vapid, phone: { id: m.id, name: String(m.name ?? "iPhone").slice(0, 40), at: this.now() } };
    this.save();
    this.box = await openBox(secret);
    // The iPhone's own room is opened first, so it is there when the iPhone arrives.
    await new Promise<void>((resolve) => {
      this.connect();
      const ws = this.ws as WebSocket | undefined;
      if (!ws) return resolve();
      const done = setTimeout(resolve, 5000);
      ws.addEventListener("open", () => (clearTimeout(done), resolve()), { once: true });
    });
    // Then told on the code's room: only the iPhone that made the claim can open it.
    if (codeWs?.readyState === 1) codeWs.send(JSON.stringify({ k: "msg", d: await seal(codeBox, { t: "paired", n: m.n, ...handover } satisfies ComputerMessage, this.now()) }));
    this.station.changed();
    // A moment for the iPhone to read it, then the code's room goes: the code is worth nothing now.
    setTimeout(() => {
      void this.forgetRoom(codeRoom, codeBox);
      try {
        codeWs?.close();
      } catch {
        // Already closed.
      }
    }, this.o.handoverMs ?? 1500);
  }

  // ---- notifications ----

  /** Tell the iPhone now: always (the setting), or because the person is away from the computer. */
  private away(): boolean {
    return this.station.snapshot().settings.phoneAlways || (this.o.away?.() ?? true);
  }

  /** Test in the settings: a pretend request, sent to the iPhone at once, wherever you are. */
  async sample(): Promise<PushReport[]> {
    const p = this.station.sample();
    return this.push({ title: "Airband test", body: "A test from your Mac. Tap Allow or Deny. Nothing runs.", tag: p.id, id: p.id, kind: "request" });
  }

  private onRequest = (p: PendingView) => {
    if (!this.file?.phone?.push || p.sample) return;
    const tell = () => {
      this.nudges.delete(p.id);
      if (!this.station.snapshot().pending.some((x) => x.id === p.id)) return;
      // The iPhone shows "Airband" and the icon itself: the title is the chat, the body what it wants.
      const body = p.detail ? `${p.title}: ${p.detail}` : p.title;
      void this.push({ title: p.chatTitle, body, tag: p.id, id: p.id, kind: answeredOnAlert(p, body) ? "request" : "question" });
    };
    if (this.away()) return tell();
    // At the computer: the iPhone is told only if the request is still waiting a little later.
    this.nudges.set(p.id, setTimeout(() => (this.away() ? tell() : this.nudges.delete(p.id)), this.o.nudgeMs ?? 45_000));
  };

  private onFinished = (f: FinishedView) => {
    if (!this.file?.phone?.push || !this.away()) return;
    // The chat, and whether the next step is yours, in the title; what happened in the body.
    const where = f.project && f.project !== f.title ? ` · ${f.project}` : "";
    const title = f.yours ? `${f.title}: your turn` : `${f.title} is done`;
    void this.push({ title: `${title}${where}`, body: f.brief ?? f.did ?? "It finished. Have a look when you're back.", tag: `done-${f.chatId}`, kind: "done" });
  };

  /** An alert to the linked iPhone, straight to Apple's push service (no relay, nothing to pay). */
  private async push(note: { title: string; body: string; tag: string; id?: string; kind?: string }): Promise<PushReport[]> {
    const phone = this.file?.phone;
    if (!this.file || !phone?.push) return [];
    const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    const payload = { ...note, title: clip(note.title, ALERT_TITLE_MAX), body: clip(note.body, ALERT_BODY_MAX) };
    let report: PushReport;
    try {
      const r = await sendPush(phone.push, payload, this.file.vapid, { topic: note.tag, ...(this.o.fetch ? { fetch: this.o.fetch } : {}) });
      const w = why(r.status);
      report = { name: phone.name, ok: !w, status: r.status, ...(w ? { why: w } : {}) };
      if (r.gone && this.file?.phone === phone) {
        delete phone.push;
        this.save();
        this.station.changed();
      }
    } catch {
      report = { name: phone.name, ok: false, status: 0, why: why(0) };
    }
    return [report];
  }
}

/**
 * Whether Allow and Deny may sit on the alert itself. Only for a plain request the alert shows whole:
 * a question or a plan is answered in the app, and so is a command that was cut or runs over several
 * lines, where the Lock Screen could hide the part that matters.
 */
export function answeredOnAlert(p: PendingView, body: string): boolean {
  if (p.questions?.length || p.toolName === "ExitPlanMode") return false;
  if (p.truncated || p.detail?.includes("\n") || p.detail?.includes("\r")) return false;
  return body.length <= ALERT_BODY_MAX;
}
