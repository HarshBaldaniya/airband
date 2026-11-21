// The phone link: the lock on every message, the relay's room, notifications, and a whole pairing
// from the Station to a phone and back, with the relay and the push service played in memory.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fromB64u, openBox, pairingFragment, parsePairing, randomB64u, seal, toB64u, unseal, MAX_AGE_MS } from "../src/remote/box";
import { isPushEndpoint, lockForPhone, newVapidKeys, sendPush, vapidAuthorization } from "../src/remote/webpush";
import { LIMITS, RoomLogic, type Role, type RoomSocket } from "../relay/src/room";
import { Station } from "../src/station/server";
import { askStation } from "../src/station/client";

// ---- the lock ----

test("a message opens only with the pair's key, unchanged and fresh", async () => {
  const secret = randomB64u(32);
  const box = await openBox(secret);
  const sealed = await seal(box, { t: "decide", id: "r1", decision: "allow" });
  assert.deepEqual(await unseal(box, sealed), { t: "decide", id: "r1", decision: "allow" });
  assert.equal(await unseal(await openBox(randomB64u(32)), sealed), undefined, "another pair's key opens nothing");
  const raw = fromB64u(sealed);
  raw[raw.length - 1] ^= 1;
  assert.equal(await unseal(box, toB64u(raw)), undefined, "a changed message is refused");
  const old = await seal(box, { t: "hello" }, Date.now() - MAX_AGE_MS - 1000);
  assert.equal(await unseal(box, old), undefined, "a copy replayed later is refused");
  assert.equal(await unseal(box, "not-a-message"), undefined);
  assert.notEqual(await seal(box, { a: 1 }), await seal(box, { a: 1 }), "each message has its own nonce");
});

test("the relay's token proves the pair without giving away the secret", async () => {
  const secret = randomB64u(32);
  const a = await openBox(secret);
  const b = await openBox(secret);
  assert.equal(a.token, b.token, "both ends compute the same token");
  assert.notEqual(a.token, secret);
  assert.notEqual(a.token, (await openBox(randomB64u(32))).token);
  await assert.rejects(openBox(randomB64u(16)), /32 bytes/);
});

test("the pairing code carries room, secret and notification key, and nothing malformed passes", () => {
  const p = { room: randomB64u(16), secret: randomB64u(32), vapid: newVapidKeys().publicKey };
  assert.deepEqual(parsePairing(`#${pairingFragment(p)}`), p);
  assert.equal(parsePairing("#abc.def.ghi"), undefined);
  assert.equal(parsePairing(`#${pairingFragment(p)}.extra`), undefined);
  assert.equal(parsePairing(""), undefined);
});

// ---- notifications ----

/** What a phone's browser does with a push: the receiving half of RFC 8291. */
function unlockOnPhone(body: Buffer, phone: crypto.ECDH, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const senderPublic = body.subarray(21, 21 + idlen);
  const locked = body.subarray(21 + idlen);
  const hmac = (k: Buffer, d: Buffer) => crypto.createHmac("sha256", k).update(d).digest();
  const shared = phone.computeSecret(senderPublic);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from("WebPush: info\0"), phone.getPublicKey(), senderPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(locked.subarray(locked.length - 16));
  const plain = Buffer.concat([d.update(locked.subarray(0, locked.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "one record, marked last");
  return plain.subarray(0, -1).toString();
}

const newPhone = () => {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, keys: { p256dh: toB64u(ecdh.getPublicKey()), auth: toB64u(auth) } };
};

test("a notification is locked for one phone and signed by this computer", async () => {
  const phone = newPhone();
  const body = lockForPhone(Buffer.from('{"title":"Billing needs you"}'), phone.keys);
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(unlockOnPhone(body, phone.ecdh, phone.auth), '{"title":"Billing needs you"}');
  assert.throws(() => unlockOnPhone(body, newPhone().ecdh, phone.auth), "another phone can't open it");
  const keys = newVapidKeys();
  const header = vapidAuthorization("https://web.push.apple.com/QGuQyavXutnMH-Ut8b0Ut", keys, 1_700_000_000_000);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
  const [h, c, s] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url").toString()) as { aud: string; exp: number; sub: string };
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.exp, 1_700_000_000 + 12 * 3600);
  assert.match(claims.sub, /^https:\/\//, "Apple needs a contact URL");
  const pub = fromB64u(k);
  const verifyKey = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: toB64u(pub.slice(1, 33)), y: toB64u(pub.slice(33)) }, format: "jwk" });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: verifyKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
});

test("notifications go only to real push services, and a phone that left is dropped", async () => {
  assert.ok(isPushEndpoint("https://web.push.apple.com/abc"));
  assert.ok(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(!isPushEndpoint("http://web.push.apple.com/abc"), "never plain http");
  assert.ok(!isPushEndpoint("https://evil.example/web.push.apple.com"));
  assert.ok(!isPushEndpoint("https://push.apple.com.evil.example/x"));
  assert.ok(!isPushEndpoint("https://127.0.0.1/x"));
  const phone = newPhone();
  const gone = await sendPush({ endpoint: "https://web.push.apple.com/x", keys: phone.keys }, { title: "t" }, newVapidKeys(), { fetch: (async () => new Response(null, { status: 410 })) as typeof fetch });
  assert.deepEqual(gone, { status: 410, gone: true });
  await assert.rejects(sendPush({ endpoint: "https://web.push.apple.com/x", keys: phone.keys }, { body: "x".repeat(4000) }, newVapidKeys(), { fetch: (async () => new Response()) as typeof fetch }), /too long/);
});

// ---- the relay's room ----

/** A relay in memory: a room's sockets and storage, as the Durable Object keeps them. */
function memoryRoom() {
  const data = new Map<string, string>();
  const sockets: (RoomSocket & { got: string[]; closed?: number })[] = [];
  const logic = new RoomLogic(
    { get: async (k) => data.get(k), put: async (k, v) => void data.set(k, v), deleteAll: async () => data.clear() },
    () => sockets.filter((s) => s.closed === undefined),
  );
  const socket = (role: Role) => {
    const s = { role, got: [] as string[], closed: undefined as number | undefined, send: (t: string) => void s.got.push(t), close: (code: number) => void (s.closed = code) };
    return s;
  };
  const join = async (role: Role, token: string) => {
    const verdict = await logic.admit(role, token);
    if (verdict !== "ok") return verdict;
    const s = socket(role);
    sockets.push(s);
    await logic.joined(s);
    return s;
  };
  return { data, sockets, logic, join };
}

test("the relay lets in only the pair: the computer opens the room, phones need the same token", async () => {
  const r = memoryRoom();
  const token = (await openBox(randomB64u(32))).token;
  assert.equal(await r.join("phone", token), "denied", "a phone can't open a room");
  const mac = await r.join("mac", token);
  assert.equal(typeof mac, "object");
  assert.equal(await r.join("phone", (await openBox(randomB64u(32))).token), "denied", "another pair's phone stays out");
  assert.equal(await r.join("mac", "x".repeat(40)), "denied", "so does another computer");
  for (let i = 0; i < LIMITS.phones; i++) assert.equal(typeof (await r.join("phone", token)), "object");
  assert.equal(await r.join("phone", token), "full");
  assert.equal(r.data.get("token")?.length, 64, "the relay keeps a hash of the token, not the token");
  assert.notEqual(r.data.get("token"), token);
});

test("the relay passes frames along, keeps the latest state, and says when the computer is away", async () => {
  const r = memoryRoom();
  const token = (await openBox(randomB64u(32))).token;
  const mac = (await r.join("mac", token)) as RoomSocket & { got: string[]; closed?: number };
  await r.logic.message(mac, JSON.stringify({ k: "state", d: "LOCKED-STATE" }));
  const phone = (await r.join("phone", token)) as RoomSocket & { got: string[] };
  assert.deepEqual(phone.got.map((t) => JSON.parse(t)), [{ k: "mac", on: true }, { k: "state", d: "LOCKED-STATE" }], "a phone that opens sees the state at once");
  await r.logic.message(phone, JSON.stringify({ k: "msg", d: "LOCKED-ANSWER" }));
  assert.deepEqual(JSON.parse(mac.got.at(-1)!), { k: "msg", d: "LOCKED-ANSWER" });
  await r.logic.message(phone, JSON.stringify({ k: "state", d: "FAKE" }));
  assert.equal(r.data.get("state"), "LOCKED-STATE", "a phone can't change the state");
  mac.closed = 1000;
  r.logic.left(mac);
  assert.deepEqual(JSON.parse(phone.got.at(-1)!), { k: "mac", on: false });
  assert.equal(await r.logic.post(token, "LOCKED"), 409, "a notification's button with the computer away");
  assert.equal(await r.logic.post("y".repeat(43), "LOCKED"), 403);
  assert.equal(await r.logic.check(token), 200);
  assert.equal(await r.logic.check("y".repeat(43)), 403);
  assert.equal(await r.logic.forget("y".repeat(43)), 403, "only the pair deletes its room");
  assert.equal(await r.logic.forget(token), 200);
  assert.equal(r.data.size, 0);
  assert.equal(await r.logic.check(token), 410, "an unlinked phone learns its pairing ended");
});

test("the relay closes a connection that floods it or sends too much at once", async () => {
  const r = memoryRoom();
  const token = (await openBox(randomB64u(32))).token;
  const mac = (await r.join("mac", token)) as RoomSocket & { closed?: number };
  await r.logic.message(mac, JSON.stringify({ k: "msg", d: "x".repeat(LIMITS.frameBytes) }));
  assert.equal(mac.closed, 4008);
  const mac2 = (await r.join("mac", token)) as RoomSocket & { closed?: number };
  for (let i = 0; i <= LIMITS.perMinute && mac2.closed === undefined; i++) await r.logic.message(mac2, '{"k":"msg","d":"x"}');
  assert.equal(mac2.closed, 4008);
});

// ---- a whole pairing, Station to phone and back ----

class FakeSocket extends EventTarget {
  readyState = 0;
  peer?: RoomSocket & { got: string[] };
  constructor(
    readonly url: string,
    private readonly relay: ReturnType<typeof memoryRoom>,
  ) {
    super();
    void this.opened();
  }
  private async opened() {
    const u = new URL(this.url);
    const role = u.searchParams.get("role") as Role;
    const verdict = await this.relay.logic.admit(role, u.searchParams.get("token"));
    if (verdict !== "ok") return this.close();
    const me = this;
    const s = { role, got: [] as string[], closed: undefined as number | undefined, send: (t: string) => queueMicrotask(() => me.dispatchEvent(Object.assign(new Event("message"), { data: t }))), close: () => me.close() };
    this.peer = s;
    this.relay.sockets.push(s);
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
    await this.relay.logic.joined(s);
  }
  send(text: string) {
    if (text !== "ping" && this.peer) void this.relay.logic.message(this.peer, text);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.peer) (this.peer as { closed?: number }).closed = 1000;
    if (this.peer) this.relay.logic.left(this.peer);
    this.dispatchEvent(new Event("close"));
  }
}

let station: Station | undefined;
beforeEach(() => {
  process.env.AIRBAND_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "airband-link-"));
});
afterEach(async () => {
  await station?.stop();
  station = undefined;
});

const until = async (f: () => boolean | Promise<boolean>, what: string) => {
  for (let i = 0; i < 300; i++) {
    if (await f()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`never: ${what}`);
};

test("pair a phone, see a request on it, allow it there: the chat gets the answer", async () => {
  const relay = memoryRoom();
  const pushes: { url: string; body: Buffer; headers: Record<string, string> }[] = [];
  const forgets: string[] = [];
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/forget")) {
      forgets.push(u);
      return new Response(null, { status: await relay.logic.forget((init?.headers as Record<string, string>)["x-room-token"]) });
    }
    else pushes.push({ url: u, body: Buffer.from(init?.body as Uint8Array), headers: init?.headers as Record<string, string> });
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  let away = true;
  station = new Station({ port: 0, claude: null, pollMs: 60_000, link: { relay: "https://relay.test", WebSocket: class extends FakeSocket { constructor(url: string) { super(url, relay); } } as unknown as typeof WebSocket, fetch: fakeFetch, away: () => away, nudgeMs: 30 } });
  await station.start();
  const s = station;
  assert.deepEqual(s.snapshot().link, { linked: false, online: false, phones: [] });

  // Link: the code the computer shows.
  const url = await s.link!.link();
  assert.match(url, /^https:\/\/relay\.test\/#/);
  const pairing = parsePairing(new URL(url).hash)!;
  assert.ok(pairing, "the code holds a pairing");
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.AIRBAND_HOME!, "phone-link.json"), "utf8")) as { secret: string };
  assert.equal(saved.secret, pairing.secret);
  await until(() => s.snapshot().link!.online, "the computer reaches the relay");

  // The phone joins with the code's secret.
  const box = await openBox(pairing.secret);
  const phone = new FakeSocket(`wss://relay.test/r/${pairing.room}/ws?role=phone&token=${box.token}`, relay);
  const states: { pending: { id: string; title: string }[] }[] = [];
  const replies: { n: number; ok: boolean; error?: string }[] = [];
  phone.addEventListener("message", (e) => {
    const f = JSON.parse((e as MessageEvent).data as string) as { k: string; d?: string };
    if (!f.d) return;
    void unseal<{ t: string; state?: never; n?: number; ok?: boolean }>(box, f.d).then((m) => {
      if (m?.t === "state") states.push(m.state as never);
      if (m?.t === "reply") replies.push(m as never);
    });
  });
  await until(() => phone.readyState === 1, "the phone connects");
  const say = async (m: unknown) => phone.send(JSON.stringify({ k: "msg", d: await seal(box, m) }));
  await say({ t: "hello" });
  await until(() => states.length > 0, "the phone gets the state");

  // Alerts on: the phone hands over its push address.
  const ph = newPhone();
  await say({ t: "subscribe", n: 1, id: "p1", name: "iPhone", sub: { endpoint: "https://web.push.apple.com/abc", keys: ph.keys } });
  await until(() => replies.some((r) => r.n === 1 && r.ok), "the computer keeps the phone");
  await until(() => pushes.length === 1, "a hello notification");
  assert.equal(JSON.parse(unlockOnPhone(pushes[0].body, ph.ecdh, ph.auth)).title, "Alerts are on");
  assert.match(pushes[0].headers.authorization, /^vapid t=.+, k=/);
  assert.deepEqual(s.snapshot().link!.phones.map((p) => p.name), ["iPhone"]);

  // A chat asks; the person is away: the phone buzzes, locked for it alone.
  const waiting = askStation({ agent: "claude", session_id: "c1", cwd: "/p/billing", tool_name: "Bash", tool_input: { command: "npm test" } });
  await until(() => states.some((st) => st.pending.length === 1), "the request reaches the phone");
  await until(() => pushes.length === 2, "the request's notification");
  const note = JSON.parse(unlockOnPhone(pushes[1].body, ph.ecdh, ph.auth)) as { title: string; body: string; kind: string; id: string };
  assert.equal(note.kind, "request");
  assert.match(note.body, /npm test/);
  assert.ok(!pushes[1].body.toString("latin1").includes("npm test"), "the push service sees no words");

  // Allow on the phone: the chat goes on.
  const id = states.at(-1)!.pending[0].id;
  assert.equal(note.id, id);
  await say({ t: "decide", n: 2, id, decision: "allow" });
  assert.equal((await waiting)?.decision, "allow");
  await until(() => replies.some((r) => r.n === 2 && r.ok), "the phone hears it worked");
  await say({ t: "decide", n: 3, id, decision: "deny" });
  await until(() => replies.some((r) => r.n === 3 && !r.ok), "a second answer is refused");

  // At the computer, with "Alert my phone always" off: no buzz unless the request is still waiting
  // a little later.
  await s.setSettings({ phoneAlways: false });
  away = false;
  const second = askStation({ agent: "claude", session_id: "c2", cwd: "/p/api", tool_name: "Bash", tool_input: { command: "ls" } });
  await until(() => states.some((st) => st.pending.length === 1 && st.pending[0].id !== id), "the second request");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(pushes.length, 2, "no buzz while you're at the computer");
  const id2 = s.snapshot().pending[0].id;
  s.decide(id2, { decision: "deny" });
  await second;

  // "Alert my phone always" (on by default): at the computer too, the phone hears at once.
  await s.setSettings({ phoneAlways: true });
  const third = askStation({ agent: "claude", session_id: "c3", cwd: "/p/web", tool_name: "Bash", tool_input: { command: "pwd" } });
  await until(() => pushes.length === 3, "a buzz at once, at the computer");
  s.decide(s.snapshot().pending[0].id, { decision: "allow" });
  await third;

  // What a phone can't do: there is no message for asking, telling a chat, or settings.
  await say({ t: "ask", n: 9, text: "read my Downloads folder" });
  await say({ t: "settings", n: 10, approvals: false });
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(!replies.some((r) => r.n === 9 || r.n === 10), "ignored, not answered");
  assert.equal(s.snapshot().settings.approvals, true);

  // A message locked with the wrong key does nothing.
  const stranger = await openBox(randomB64u(32));
  phone.send(JSON.stringify({ k: "msg", d: await seal(stranger, { t: "decide", n: 11, id, decision: "allow" }) }));
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(!replies.some((r) => r.n === 11));

  // Unlink: the room goes on the relay, and the secret here.
  await s.link!.unlink();
  assert.equal(forgets.length, 1);
  assert.equal(s.snapshot().link!.linked, false);
  assert.equal(await relay.logic.check(box.token), 410);
});

test("Test on the computer: a pretend request reaches the phone at once, and the answer comes back", async () => {
  const relay = memoryRoom();
  let status = 201;
  const pushes: Buffer[] = [];
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith("/forget")) return new Response(null, { status: 200 });
    pushes.push(Buffer.from(init?.body as Uint8Array));
    return new Response(null, { status });
  }) as typeof fetch;
  station = new Station({ port: 0, claude: null, pollMs: 60_000, link: { relay: "https://relay.test", WebSocket: class extends FakeSocket { constructor(url: string) { super(url, relay); } } as unknown as typeof WebSocket, fetch: fakeFetch, away: () => false } });
  await station.start();
  const s = station;
  const pairing = parsePairing(new URL(await s.link!.link()).hash)!;
  await until(() => s.snapshot().link!.online, "online");
  assert.deepEqual(await s.link!.sample(), [], "no phone with alerts yet: nothing sent, and the caller says so");
  const box = await openBox(pairing.secret);
  const phone = new FakeSocket(`wss://relay.test/r/${pairing.room}/ws?role=phone&token=${box.token}`, relay);
  const replies: { n: number; ok: boolean; error?: string }[] = [];
  phone.addEventListener("message", (e) => {
    const f = JSON.parse((e as MessageEvent).data as string) as { d?: string };
    if (f.d) void unseal<{ t: string }>(box, f.d).then((m) => m?.t === "reply" && replies.push(m as never));
  });
  await until(() => phone.readyState === 1, "phone");
  const say = async (m: unknown) => phone.send(JSON.stringify({ k: "msg", d: await seal(box, m) }));
  const ph = newPhone();
  await say({ t: "subscribe", n: 1, id: "p1", name: "iPhone", sub: { endpoint: "https://web.push.apple.com/abc", keys: ph.keys } });
  await until(() => replies.some((r) => r.n === 1), "subscribed");
  await until(() => pushes.length === 1, "the hello alert");

  // At the computer, and still the test goes at once.
  const reports = await s.link!.sample();
  assert.deepEqual(reports, [{ name: "iPhone", ok: true, status: 201 }]);
  const note = JSON.parse(unlockOnPhone(pushes[1], ph.ecdh, ph.auth)) as { title: string; kind: string; id: string };
  assert.equal(note.kind, "request");
  const pending = s.snapshot().pending;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].sample, true);
  await say({ t: "decide", n: 2, id: note.id, decision: "always" });
  await until(() => s.snapshot().test?.answer === "always", "the answer reaches the computer");
  assert.equal(s.snapshot().test?.from, "phone");
  assert.equal(s.snapshot().pending.length, 0);
  assert.ok(!fs.existsSync(path.join(process.env.AIRBAND_HOME!, "station-rules.json")), "a test's Always remembers nothing");

  // Send me a test alert, from the phone.
  await say({ t: "test", n: 3 });
  await until(() => replies.some((r) => r.n === 3 && r.ok), "the phone hears it was sent");
  assert.equal(JSON.parse(unlockOnPhone(pushes.at(-1)!, ph.ecdh, ph.auth)).title, "Test from your computer");

  // The phone turned alerts off: the report says what to do, and the phone is dropped.
  status = 410;
  const off = await s.link!.sample();
  assert.equal(off[0].ok, false);
  assert.match(off[0].why!, /turned its alerts off/);
  assert.deepEqual(s.link!.status().phones, []);
});
