// The relay's door for new rooms: one per address on the internet (a Durable Object named by a hash
// of it). Making a room is free for whoever asks, so without a door one script could fill the free
// plan with rooms nobody uses. Each address may open a few rooms an hour and hold a few dozen at once.
// A room gives its place back when it is unlinked or deleted for being idle. Plain TypeScript with no
// Cloudflare types, so tests run it.

export const GATE_LIMITS = {
  /** New rooms one address may open in an hour: a person links an iPhone once, and rarely again. */
  perHour: 10,
  /** Rooms one address may hold at once. An office behind one address still has room. */
  rooms: 40,
  /** An address with no new rooms for this long is forgotten. */
  idleMs: 31 * 24 * 3600e3,
};

export interface GateStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
}

interface Count {
  hour: number;
  made: number;
  rooms: number;
}

export class GateLogic {
  constructor(
    private readonly store: GateStore,
    private readonly now: () => number = Date.now,
  ) {}

  private async read(): Promise<Count> {
    try {
      const c = JSON.parse((await this.store.get("count")) ?? "{}") as Partial<Count>;
      return { hour: Number(c.hour) || 0, made: Number(c.made) || 0, rooms: Number(c.rooms) || 0 };
    } catch {
      return { hour: 0, made: 0, rooms: 0 };
    }
  }

  /** Whether this address may open one more room; when it may, the room is counted. */
  async open(): Promise<boolean> {
    const c = await this.read();
    const hour = Math.floor(this.now() / 3600e3);
    const made = c.hour === hour ? c.made : 0;
    if (made >= GATE_LIMITS.perHour || c.rooms >= GATE_LIMITS.rooms) return false;
    await this.store.put("count", JSON.stringify({ hour, made: made + 1, rooms: c.rooms + 1 } satisfies Count));
    return true;
  }

  /** A room this address opened is gone. */
  async closed(): Promise<void> {
    const c = await this.read();
    await this.store.put("count", JSON.stringify({ ...c, rooms: Math.max(0, c.rooms - 1) } satisfies Count));
  }
}

/** The name a gate goes by: a hash, so no address is kept as written. */
export async function gateName(address: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`airband gate v1 ${address}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
