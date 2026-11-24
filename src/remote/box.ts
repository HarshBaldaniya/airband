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

// ---- the claim ----
//
// The code's room can have more than one phone on it: anyone who saw the code can join it. So the
// new room and secret are not sent locked with the code alone. The claiming phone brings a key pair
// made for this one claim (ECDH, P-256) and sends its public half. The computer makes one too, and
// locks the new secret with what only the two of them can work out. Another phone holding the code
// hears the answer and cannot open it.

const CLAIM_CURVE = { name: "ECDH", namedCurve: "P-256" } as const;

export interface ClaimKey {
  privateKey: CryptoKey;
  /** The public half, sent in the claim. */
  publicKey: string;
}

/** A key pair for one claim. It is never saved: a claim that fails is simply made again. */
export async function newClaimKey(): Promise<ClaimKey> {
  const pair = (await subtle().generateKey(CLAIM_CURVE, false, ["deriveBits"])) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: toB64u(raw) };
}

async function claimBox(privateKey: CryptoKey, peerPublicKey: string): Promise<Box> {
  const peer = await subtle().importKey("raw", fromB64u(peerPublicKey) as BufferSource, CLAIM_CURVE, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: peer }, privateKey, 256));
  const key = await subtle().importKey("raw", await derive(shared, "airband claim v1"), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { key, token: "" };
}

/** The computer's side: `body` locked for the phone whose claim carried `phonePublicKey`. Throws on a bad key. */
export async function sealForClaim(phonePublicKey: string, body: unknown, now = Date.now()): Promise<{ key: string; d: string }> {
  const mine = await newClaimKey();
  const box = await claimBox(mine.privateKey, phonePublicKey);
  return { key: mine.publicKey, d: await seal(box, body, now) };
}

/** The phone's side: opens what the computer locked for this claim, or undefined. */
export async function openClaim<T = unknown>(mine: ClaimKey, computerPublicKey: string, sealed: string, now = Date.now()): Promise<T | undefined> {
  try {
    return await unseal<T>(await claimBox(mine.privateKey, computerPublicKey), sealed, now);
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
  /** This phone owns the pairing: the code it scanned was used up and swapped for a secret of its own. */
  claimed?: boolean;
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
  /** The first message on a code: this phone takes the link. The code works once, for one phone. */
  | { t: "claim"; n: number; id: string; name: string; key: string }
  | { t: "hello" }
  | { t: "decide"; n: number; id: string; decision: "allow" | "always" | "deny" | "terminal"; answers?: Record<string, string | string[]>; message?: string }
  | { t: "dismiss"; n: number; chatId: string }
  | { t: "subscribe"; n: number; id: string; name: string; sub: { endpoint: string; keys: { p256dh: string; auth: string } } }
  | { t: "forget"; id: string }
  | { t: "test"; n: number };

export type ComputerMessage =
  | { t: "state"; state: unknown }
  | { t: "reply"; n: number; ok: boolean; error?: string }
  /** The claim worked: the phone's own room and secret, locked for the claiming phone alone (`openClaim`). */
  | { t: "paired"; n: number; key: string; d: string };

/** What a `paired` message holds, once the claiming phone opens it. */
export interface ClaimedRoom {
  room: string;
  secret: string;
}

/** What travels through the relay, outside the lock: only which kind it is, never what it says. */
export type RelayFrame = { k: "state" | "msg"; d: string } | { k: "mac"; on: boolean } | { k: "phones"; n: number };
