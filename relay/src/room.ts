// One pair's room on the relay: the computer and its linked phones meet here. The relay only passes
// locked messages along (it has no key to open them) and keeps one thing: the latest locked state, so
// a phone that opens sees it at once. Plain TypeScript with no Cloudflare types, so tests run it.

export type Role = "mac" | "phone";

export interface RoomSocket {
  role: Role;
  send(text: string): void;
  close(code: number, reason: string): void;
}

export interface RoomStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  deleteAll(): Promise<void>;
}

export const LIMITS = {
  /** One frame: a locked state with the chats that show on a phone. */
  frameBytes: 128 * 1024,
  /** One phone per computer: its app, and a second connection while it reopens. */
  phones: 2,
  /** Frames one connection may send a minute. */
  perMinute: 300,
  /** A room nobody opened for this long is deleted. */
  idleMs: 30 * 24 * 3600e3,
};

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class RoomLogic {
  private counts = new WeakMap<RoomSocket, { minute: number; n: number }>();

  constructor(
    private readonly store: RoomStore,
    private readonly sockets: () => RoomSocket[],
    private readonly now: () => number = Date.now,
  ) {}

  /** The computer opens the room the first time; after that, only the same pair gets in. */
  async admit(role: Role, token: string | null): Promise<"ok" | "denied" | "full"> {
    if (!token || token.length < 32 || token.length > 64) return "denied";
    const hash = await sha256(token);
    const known = await this.store.get("token");
    if (!known) {
      if (role !== "mac") return "denied";
      await this.store.put("token", hash);
    } else if (known !== hash) return "denied";
    if (role === "phone" && this.sockets().filter((s) => s.role === "phone").length >= LIMITS.phones) return "full";
    await this.store.put("seen", String(this.now()));
    return "ok";
  }

  /** A socket just came in: a phone learns whether the computer is there, and the latest state. */
  async joined(s: RoomSocket): Promise<void> {
    if (s.role === "mac") {
      // One computer per room: an older connection of its own is replaced.
      for (const o of this.sockets()) if (o !== s && o.role === "mac") o.close(4000, "replaced");
      this.toPhones({ k: "mac", on: true });
      s.send(JSON.stringify({ k: "phones", n: this.phoneCount() }));
      return;
    }
    s.send(JSON.stringify({ k: "mac", on: this.sockets().some((o) => o.role === "mac") }));
    // The computer sends its state only while a phone is looking: nothing travels otherwise.
    this.tellMacPhones();
    const state = await this.store.get("state");
    if (state) s.send(JSON.stringify({ k: "state", d: state }));
  }

  async message(from: RoomSocket, raw: string): Promise<void> {
    if (raw.length > LIMITS.frameBytes || !this.allowed(from)) return from.close(4008, "too much");
    let frame: { k?: unknown; d?: unknown };
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      return;
    }
    if (typeof frame.d !== "string") return;
    if (from.role === "mac") {
      if (frame.k === "state") await this.store.put("state", frame.d);
      if (frame.k === "state" || frame.k === "msg") this.toPhones({ k: frame.k, d: frame.d });
      return;
    }
    if (frame.k === "msg") this.toMac(from, frame.d);
  }

  left(s: RoomSocket): void {
    if (s.role === "mac" && !this.sockets().some((o) => o !== s && o.role === "mac")) this.toPhones({ k: "mac", on: false }, s);
    if (s.role === "phone") this.tellMacPhones(s);
  }

  private phoneCount(except?: RoomSocket): number {
    return this.sockets().filter((o) => o.role === "phone" && o !== except).length;
  }

  private tellMacPhones(except?: RoomSocket): void {
    const mac = this.sockets().find((o) => o.role === "mac");
    if (mac) mac.send(JSON.stringify({ k: "phones", n: this.phoneCount(except) }));
  }

  /** A message from a phone's notification button (its service worker has no open connection). */
  async post(token: string | null, d: unknown): Promise<number> {
    if ((await this.admit("phone", token)) === "denied") return 403;
    if (typeof d !== "string" || d.length > LIMITS.frameBytes) return 400;
    const mac = this.sockets().find((s) => s.role === "mac");
    if (!mac) return 409;
    mac.send(JSON.stringify({ k: "msg", d }));
    return 202;
  }

  /** Whether a phone's pairing still holds: 200, or 410 when the computer ended it (or never made it). */
  async check(token: string | null): Promise<number> {
    const known = await this.store.get("token");
    if (!known) return 410;
    return token && known === (await sha256(token)) ? 200 : 403;
  }

  /** The computer unlinked: the room and everything in it goes. */
  async forget(token: string | null): Promise<number> {
    const known = await this.store.get("token");
    if (!token || !known || known !== (await sha256(token))) return 403;
    for (const s of this.sockets()) s.close(4001, "unlinked");
    await this.store.deleteAll();
    return 200;
  }

  /** Whether the room is idle long enough to delete. */
  async stale(): Promise<boolean> {
    const seen = Number((await this.store.get("seen")) ?? 0);
    return !this.sockets().length && this.now() - seen > LIMITS.idleMs;
  }

  private allowed(s: RoomSocket): boolean {
    const minute = Math.floor(this.now() / 60_000);
    const c = this.counts.get(s);
    if (!c || c.minute !== minute) {
      this.counts.set(s, { minute, n: 1 });
      return true;
    }
    return ++c.n <= LIMITS.perMinute;
  }

  private toPhones(frame: unknown, except?: RoomSocket): void {
    const text = JSON.stringify(frame);
    for (const s of this.sockets()) if (s.role === "phone" && s !== except) s.send(text);
  }

  private toMac(from: RoomSocket, d: string): void {
    const mac = this.sockets().find((s) => s.role === "mac");
    if (mac) mac.send(JSON.stringify({ k: "msg", d }));
    else from.send(JSON.stringify({ k: "mac", on: false }));
  }
}
