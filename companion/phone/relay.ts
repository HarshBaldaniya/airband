// The phone app's connection to its computer, through Airband's relay. Everything sent and received
// is locked with the pair's key; the relay sees only which kind of frame passes. It reconnects by
// itself, and at once when the app comes back to the screen (a phone pauses connections in the
// background).
import { newClaimKey, openBox, openClaim, seal, unseal, type Box, type ClaimedRoom, type ClaimKey, type ComputerMessage, type Pairing, type PhoneMessage, type RelayFrame } from "../../src/remote/box";
import type { StationState, Transport } from "../api/station";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class RelayLink implements Transport {
  private ws?: WebSocket;
  private n = 1;
  private waiting = new Map<number, Pending>();
  /** The key pair of the claim on its way, so the answer can be opened. */
  private claimKey?: ClaimKey;
  private onState?: (s: StationState) => void;
  private onLink?: (up: boolean) => void;
  private stopped = false;
  private retryMs = 1000;
  private retry?: ReturnType<typeof setTimeout>;
  private ping?: ReturnType<typeof setInterval>;
  /** The relay is reachable, and so is the computer. */
  macOnline = false;
  private listeners = new Set<() => void>();
  /** The Mac ended the link (Unlink there): the app goes back to linking at once. */
  onEnded?: () => void;

  private constructor(
    readonly pairing: Pairing,
    private readonly box: Box,
  ) {}

  /** Proof of the pair, for the relay's checks. */
  get token(): string {
    return this.box.token;
  }

  static async open(pairing: Pairing): Promise<RelayLink> {
    return new RelayLink(pairing, await openBox(pairing.secret));
  }

  /** Called when the computer comes or goes. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  watch(onState: (s: StationState) => void, onLink: (up: boolean) => void): () => void {
    this.onState = onState;
    this.onLink = onLink;
    this.stopped = false;
    this.connect();
    const wake = () => {
      if (document.visibilityState === "visible" && this.ws?.readyState !== WebSocket.OPEN) {
        clearTimeout(this.retry);
        this.retryMs = 1000;
        this.connect();
      }
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      this.stopped = true;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      clearTimeout(this.retry);
      clearInterval(this.ping);
      this.ws?.close();
    };
  }

  private connect(): void {
    if (this.stopped) return;
    this.ws?.close();
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/r/${this.pairing.room}/ws?role=phone&token=${encodeURIComponent(this.box.token)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 1000;
      if (this.pairing.claimed) void this.send({ t: "hello" });
      clearInterval(this.ping);
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 30_000);
    };
    ws.onmessage = (e) => void this.received(String(e.data));
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      if (e.code === 4001) {
        this.stopped = true;
        return this.onEnded?.();
      }
      clearInterval(this.ping);
      this.setMac(false);
      if (!this.stopped) {
        this.retry = setTimeout(() => this.connect(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 30_000);
      }
    };
  }

  private setMac(on: boolean): void {
    this.macOnline = on;
    this.onLink?.(on);
    for (const cb of this.listeners) cb();
  }

  private async received(raw: string): Promise<void> {
    if (raw === "pong") return;
    let f: RelayFrame;
    try {
      f = JSON.parse(raw) as RelayFrame;
    } catch {
      return;
    }
    if (f.k === "phones") return;
    if (f.k === "mac") {
      this.setMac(f.on);
      if (f.on && this.pairing.claimed) void this.send({ t: "hello" });
      return;
    }
    const m = await unseal<ComputerMessage>(this.box, f.d);
    if (!m) return;
    if (m.t === "state") {
      if (!this.macOnline) this.setMac(true);
      this.onState?.(m.state as StationState);
    } else if (m.t === "paired") {
      const w = this.waiting.get(m.n);
      if (!w || !this.claimKey) return;
      const own = await openClaim<ClaimedRoom>(this.claimKey, m.key, m.d);
      if (!own) return;
      this.waiting.delete(m.n);
      clearTimeout(w.timer);
      w.resolve({ room: own.room, secret: own.secret });
    } else if (m.t === "reply") {
      const w = this.waiting.get(m.n);
      if (!w) return;
      this.waiting.delete(m.n);
      clearTimeout(w.timer);
      if (m.ok) w.resolve({ ok: true });
      else w.reject(new Error(m.error ?? "Your computer said no."));
    }
  }

  private async send(m: PhoneMessage): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) throw new Error("Not connected to your computer.");
    this.ws.send(JSON.stringify({ k: "msg", d: await seal(this.box, m) }));
  }

  /** Sends, and waits for the computer's answer. */
  private ask(m: PhoneMessage & { n: number }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(m.n);
        reject(new Error("Your computer didn't answer. Is it awake?"));
      }, 10_000);
      this.waiting.set(m.n, { resolve, reject, timer });
      this.send(m).catch((e: Error) => {
        clearTimeout(timer);
        this.waiting.delete(m.n);
        reject(e);
      });
    });
  }

  async post<T>(route: string, body: unknown): Promise<T> {
    const b = body as Record<string, unknown>;
    if (route === "/api/decide") {
      const { id, decision, answers, message } = b as { id: string; decision: "allow" | "always" | "deny" | "terminal"; answers?: Record<string, string | string[]>; message?: string };
      return (await this.ask({ t: "decide", n: this.n++, id, decision, ...(answers ? { answers } : {}), ...(message ? { message } : {}) })) as T;
    }
    if (route === "/api/dismiss") return (await this.ask({ t: "dismiss", n: this.n++, chatId: String(b.chatId) })) as T;
    throw new Error("That is done on your computer.");
  }

  /** Takes the link with the scanned code: the Mac answers with this iPhone's own room and secret. */
  async claim(id: string, name: string): Promise<ClaimedRoom> {
    this.claimKey = await newClaimKey();
    return (await this.ask({ t: "claim", n: this.n++, id, name, key: this.claimKey.publicKey })) as ClaimedRoom;
  }

  /** Opens the connection and waits until it is open (for a claim, before any state). */
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stopped = false;
      this.connect();
      const ws = this.ws!;
      const t = setTimeout(() => reject(new Error("Couldn't reach Airband. Check the internet on this iPhone.")), 10_000);
      ws.addEventListener("open", () => (clearTimeout(t), resolve()), { once: true });
    });
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.ping);
    this.ws?.close();
  }

  subscribe(id: string, name: string, sub: PushSubscriptionJSON): Promise<unknown> {
    const keys = sub.keys ?? {};
    return this.ask({ t: "subscribe", n: this.n++, id, name, sub: { endpoint: sub.endpoint ?? "", keys: { p256dh: keys.p256dh ?? "", auth: keys.auth ?? "" } } });
  }

  /** Asks the computer to send this phone a test alert. */
  testAlert(): Promise<unknown> {
    return this.ask({ t: "test", n: this.n++ });
  }

  async forget(id: string): Promise<void> {
    await this.send({ t: "forget", id }).catch(() => undefined);
  }
}
