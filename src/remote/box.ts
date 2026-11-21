// The lock on every message between the computer and a linked phone. Both ends hold one secret,
// made by the computer and handed to the phone inside the pairing code; it never reaches the relay.
// From that secret come two keys: one locks and unlocks messages (AES-256-GCM), the other proves to
// the relay that a connection belongs to the pair (the "room token"), without the relay learning
// the secret. The same code runs in Node (the computer) and in the phone's browser (WebCrypto).

const text = new TextEncoder();
const words = new TextDecoder();

const subtle = () => globalThis.crypto.subtle;

export function toB64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export const randomB64u = (n: number) => toB64u(globalThis.crypto.getRandomValues(new Uint8Array(n)));

async function derive(secret: Uint8Array, info: string): Promise<ArrayBuffer> {
  const base = await subtle().importKey("raw", secret as BufferSource, "HKDF", false, ["deriveBits"]);
  return subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: text.encode(info) }, base, 256);
}

export interface Box {
  key: CryptoKey;
  /** What the relay checks: proof of the pair, from which the secret cannot be worked out. */
  token: string;
}

export async function openBox(secretB64u: string): Promise<Box> {
  const secret = fromB64u(secretB64u);
  if (secret.length !== 32) throw new Error("A pairing secret is 32 bytes.");
  const key = await subtle().importKey("raw", await derive(secret, "airband box v1"), "AES-GCM", false, ["encrypt", "decrypt"]);
  const token = toB64u(new Uint8Array(await derive(secret, "airband room v1")));
  return { key, token };
}

/** A message older (or newer) than this is refused: a copy replayed later does nothing. */
export const MAX_AGE_MS = 5 * 60_000;

export async function seal(box: Box, body: unknown, now = Date.now()): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = text.encode(JSON.stringify({ at: now, body }));
  const locked = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, box.key, data));
  const out = new Uint8Array(iv.length + locked.length);
  out.set(iv);
  out.set(locked, iv.length);
  return toB64u(out);
}

/** The message, or undefined when it was not locked with this pair's key, was changed, or is stale. */
export async function unseal<T = unknown>(box: Box, sealed: string, now = Date.now()): Promise<T | undefined> {
  try {
    const raw = fromB64u(sealed);
    if (raw.length < 12 + 16) return undefined;
    const plain = await subtle().decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, box.key, raw.slice(12));
    const msg = JSON.parse(words.decode(plain)) as { at?: unknown; body?: T };
    if (typeof msg.at !== "number" || Math.abs(now - msg.at) > MAX_AGE_MS) return undefined;
    return msg.body;
  } catch {
    return undefined;
  }
}

/** What the pairing code carries, after the "#": never sent to any server by a browser. */
export interface Pairing {
  room: string;
  secret: string;
  /** The computer's public key for phone notifications (Web Push, VAPID). */
  vapid: string;
}

export const ROOM_RE = /^[A-Za-z0-9_-]{22}$/;

export function pairingFragment(p: Pairing): string {
  return `${p.room}.${p.secret}.${p.vapid}`;
}

export function parsePairing(fragment: string): Pairing | undefined {
  const [room, secret, vapid, ...rest] = fragment.replace(/^#/, "").split(".");
  if (rest.length || !room || !secret || !vapid) return undefined;
  if (!ROOM_RE.test(room) || !/^[A-Za-z0-9_-]{43}$/.test(secret) || !/^[A-Za-z0-9_-]{87}$/.test(vapid)) return undefined;
  return { room, secret, vapid };
}

/** What the computer and the phone say to each other, inside the lock. */
export type PhoneMessage =
  | { t: "hello" }
  | { t: "decide"; n: number; id: string; decision: "allow" | "always" | "deny" | "terminal"; answers?: Record<string, string | string[]>; message?: string }
  | { t: "dismiss"; n: number; chatId: string }
  | { t: "subscribe"; n: number; id: string; name: string; sub: { endpoint: string; keys: { p256dh: string; auth: string } } }
  | { t: "forget"; id: string };

export type ComputerMessage = { t: "state"; state: unknown } | { t: "reply"; n: number; ok: boolean; error?: string };

/** What travels through the relay, outside the lock: only which kind it is, never what it says. */
export type RelayFrame = { k: "state" | "msg"; d: string } | { k: "mac"; on: boolean };
