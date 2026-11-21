// Notifications to a linked phone, sent by the computer itself through the phone's own push service
// (Apple's for an iPhone, Google's for Android): no server of ours in between. Each one is locked for
// that phone alone (RFC 8291), so the push service carries it without being able to read it, and is
// signed with this computer's key (VAPID, RFC 8292), so the push service knows who sends it.
import * as crypto from "node:crypto";
import { fromB64u, toB64u } from "./box";

export interface VapidKeys {
  /** The uncompressed P-256 point, 65 bytes, base64url. */
  publicKey: string;
  privateKey: string;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function newVapidKeys(): VapidKeys {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: toB64u(ecdh.getPublicKey()), privateKey: toB64u(ecdh.getPrivateKey()) };
}

// Only the real push services: a linked phone hands over its address, and nothing else is posted to.
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

/** Who sends: Apple refuses a push without a contact URL or address. The project's public page. */
export const PUSH_SUBJECT = "https://github.com/HarshBaldaniya/airband";

export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): string {
  const pub = fromB64u(keys.publicKey);
  const key = crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", d: keys.privateKey, x: toB64u(pub.slice(1, 33)), y: toB64u(pub.slice(33, 65)) }, format: "jwk" });
  const part = (o: unknown) => toB64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: PUSH_SUBJECT })}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${toB64u(signature)}, k=${keys.publicKey}`;
}

const hmac = (key: Uint8Array, data: Uint8Array) => crypto.createHmac("sha256", key).update(data).digest();

/** The push body, locked for one phone (RFC 8291, "aes128gcm"). `salt` and `sender` only for tests. */
export function lockForPhone(payload: Uint8Array, target: PushTarget["keys"], salt = crypto.randomBytes(16), sender?: crypto.ECDH): Buffer {
  const phonePublic = fromB64u(target.p256dh);
  const authSecret = fromB64u(target.auth);
  const ecdh = sender ?? crypto.createECDH("prime256v1");
  if (!sender) ecdh.generateKeys();
  const senderPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(phonePublic);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), phonePublic, senderPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  // One record: the payload, then the last-record mark (0x02), no padding.
  const locked = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, locked]);
}

/** A push is small: what a notification says. Push services take at most about 4 KB. */
export const PUSH_MAX_BYTES = 3000;

export interface PushResult {
  status: number;
  /** The phone unsubscribed or was reset: its address will never work again. */
  gone: boolean;
}

export async function sendPush(target: PushTarget, payload: unknown, keys: VapidKeys, o: { ttlSeconds?: number; urgency?: "high" | "normal"; topic?: string; fetch?: typeof fetch } = {}): Promise<PushResult> {
  if (!isPushEndpoint(target.endpoint)) return { status: 0, gone: true };
  const body = Buffer.from(JSON.stringify(payload));
  if (body.length > PUSH_MAX_BYTES) throw new Error("A notification is too long to send.");
  const headers: Record<string, string> = {
    authorization: vapidAuthorization(target.endpoint, keys),
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(o.ttlSeconds ?? 120),
    urgency: o.urgency ?? "high",
  };
  // A newer notice with the same topic replaces one the phone has not received yet.
  if (o.topic) headers.topic = o.topic.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const res = await (o.fetch ?? fetch)(target.endpoint, { method: "POST", headers, body: new Uint8Array(lockForPhone(body, target.keys)) });
  return { status: res.status, gone: res.status === 404 || res.status === 410 };
}
