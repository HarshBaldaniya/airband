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
  assert.ok(!isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"), "iPhone only: Apple's push service, not Google's");
  assert.ok(!isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc"));
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

// ---- a whole pairing, Station to iPhone and back ----

/** Airband's relay in memory: one room per id, as Durable Objects keep them. */
function memoryRelay() {
  const rooms = new Map<string, ReturnType<typeof memoryRoom>>();
  const room = (id: string) => {
    if (!rooms.has(id)) rooms.set(id, memoryRoom());
    return rooms.get(id)!;
  };
  return { rooms, room };
}
type Relay = ReturnType<typeof memoryRelay>;

class FakeSocket extends EventTarget {
  readyState = 0;
  peer?: RoomSocket & { got: string[] };
  private readonly room: ReturnType<typeof memoryRoom>;
  constructor(
    readonly url: string,
    relay: Relay,
  ) {
    super();
    this.room = relay.room(/\/r\/([^/]+)\/ws/.exec(new URL(url).pathname)![1]);
    void this.opened();
  }
  private async opened() {
    const u = new URL(this.url);
    const role = u.searchParams.get("role") as Role;
    const verdict = await this.room.logic.admit(role, u.searchParams.get("token"));
    if (this.readyState === 3) return;
    if (verdict !== "ok") return this.close(4003);
    const me = this;
    const s = { role, got: [] as string[], closed: undefined as number | undefined, send: (t: string) => queueMicrotask(() => me.dispatchEvent(Object.assign(new Event("message"), { data: t }))), close: (code: number) => me.close(code) };
    this.peer = s;
    this.room.sockets.push(s);
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
    await this.room.logic.joined(s);
  }
  send(text: string) {
    if (text !== "ping" && this.peer) void this.room.logic.message(this.peer, text);
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.peer) (this.peer as { closed?: number }).closed = code;
    if (this.peer) this.room.logic.left(this.peer);
    this.dispatchEvent(Object.assign(new Event("close"), { code }));
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

interface Heard {
  t: string;
  n?: number;
  ok?: boolean;
  error?: string;
  room?: string;
  secret?: string;
  state?: { pending: { id: string; cwd?: string }[]; chats: { cwd?: string }[] };
}

/** An iPhone's connection to one room, with everything it hears unlocked. */
async function phoneOn(relay: Relay, room: string, secret: string, clock: () => number = Date.now) {
  const box = await openBox(secret);
  const ws = new FakeSocket(`wss://relay.test/r/${room}/ws?role=phone&token=${box.token}`, relay);
  const heard: Heard[] = [];
  ws.addEventListener("message", (e) => {
    const f = JSON.parse((e as MessageEvent).data as string) as { d?: string };
    if (f.d) void unseal<Heard>(box, f.d, clock()).then((m) => m && heard.push(m));
  });
  const say = async (m: unknown) => ws.send(JSON.stringify({ k: "msg", d: await seal(box, m, clock()) }));
  return { box, ws, heard, say };
}

function newStation(relay: Relay, pushes: { body: Buffer }[], opts: { away?: () => boolean; now?: () => number } = {}) {
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const forget = /\/r\/([^/]+)\/forget$/.exec(u);
    if (forget) return new Response(null, { status: await relay.room(forget[1]).logic.forget((init?.headers as Record<string, string>)["x-room-token"]) });
    pushes.push({ body: Buffer.from(init?.body as Uint8Array) });
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  return new Station({ port: 0, claude: null, pollMs: 60_000, link: { relay: "https://relay.test", WebSocket: class extends FakeSocket { constructor(url: string) { super(url, relay); } } as unknown as typeof WebSocket, fetch: fakeFetch, away: opts.away ?? (() => true), nudgeMs: 30, handoverMs: 20, ...(opts.now ? { now: opts.now } : {}) } });
}

/** Link, scan, claim: the iPhone's own room, joined and hearing the state. */
async function pairIPhone(s: Station, relay: Relay) {
  const code = parsePairing(new URL(await s.link!.link()).hash)!;
  await until(() => s.snapshot().link!.online, "the Mac reaches the relay");
  const scanned = await phoneOn(relay, code.room, code.secret);
  await until(() => scanned.ws.readyState === 1, "the iPhone opens the code");
  await scanned.say({ t: "claim", n: 1, id: "a1b2c3d4e5f6", name: "iPhone" });
  await until(() => scanned.heard.some((m) => m.t === "paired"), "the Mac hands over the iPhone's own secret");
  const paired = scanned.heard.find((m) => m.t === "paired")!;
  const own = await phoneOn(relay, paired.room!, paired.secret!);
  await until(() => s.snapshot().link!.online && own.ws.readyState === 1, "the iPhone on its own room");
  await own.say({ t: "hello" });
  await until(() => own.heard.some((m) => m.t === "state"), "the iPhone hears the state");
  return { code, scanned, own, paired };
}

test("a code works once, for one iPhone: it gets a secret of its own and the code is worth nothing after", async () => {
  const relay = memoryRelay();
  const pushes: { body: Buffer }[] = [];
  station = newStation(relay, pushes);
  await station.start();
  const s = station;
  const url = await s.link!.link();
  const code = parsePairing(new URL(url).hash)!;
  assert.ok(s.snapshot().link!.codeUntil! - Date.now() > 9 * 60_000, "about 10 minutes to scan it");
  assert.equal(s.snapshot().link!.linked, false);
  await until(() => s.snapshot().link!.online, "online");

  // Holding only the code, nothing about your chats is heard: the only answer is to a claim.
  const scanned = await phoneOn(relay, code.room, code.secret);
  await until(() => scanned.ws.readyState === 1, "open");
  await scanned.say({ t: "hello" });
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(!scanned.heard.some((m) => m.t === "state"), "no state on a code");
  await scanned.say({ t: "claim", n: 1, id: "a1b2c3d4e5f6", name: "iPhone" });
  await until(() => scanned.heard.some((m) => m.t === "paired"), "claimed");
  const paired = scanned.heard.find((m) => m.t === "paired")!;
  assert.notEqual(paired.room, code.room);
  assert.notEqual(paired.secret, code.secret);
  assert.deepEqual(s.snapshot().link!.phones, [{ name: "iPhone", at: s.snapshot().link!.phones[0].at, alerts: false }]);
  assert.equal(s.snapshot().link!.linked, true);
  assert.equal(s.link!.pairingUrl(), undefined, "no code to show any more");

  // Someone who photographed the code: the room is gone, so they get nowhere.
  await until(async () => (await relay.room(code.room).logic.check(scanned.box.token)) === 410, "the code's room is deleted");
  const late = await phoneOn(relay, code.room, code.secret);
  await until(() => late.ws.readyState === 3, "a second iPhone is turned away");
  const saved = fs.readFileSync(path.join(process.env.AIRBAND_HOME!, "phone-link.json"), "utf8");
  assert.ok(!saved.includes(code.secret), "the Mac forgot the code's secret");
  assert.ok(saved.includes(paired.secret!));
});

test("a code nobody scans in 10 minutes runs out", async () => {
  const relay = memoryRelay();
  let offset = 0;
  const clock = () => Date.now() + offset;
  station = newStation(relay, [], { now: clock });
  await station.start();
  const s = station;
  const code = parsePairing(new URL(await s.link!.link()).hash)!;
  await until(() => s.snapshot().link!.online, "online");
  const scanned = await phoneOn(relay, code.room, code.secret, clock);
  await until(() => scanned.ws.readyState === 1, "open");
  offset = 11 * 60_000;
  await scanned.say({ t: "claim", n: 1, id: "a1b2c3d4e5f6", name: "iPhone" });
  await until(() => scanned.heard.some((m) => m.t === "reply"), "the Mac answers");
  assert.match(scanned.heard[0].error!, /expired/);
  assert.equal(s.snapshot().link!.linked, false);
});

test("pair an iPhone, see a request on it, allow it there: the chat gets the answer", async () => {
  const relay = memoryRelay();
  const pushes: { body: Buffer }[] = [];
  let away = true;
  station = newStation(relay, pushes, { away: () => away });
  await station.start();
  const s = station;
  const { own, paired } = await pairIPhone(s, relay);

  // Alerts: only through Apple's push service.
  await own.say({ t: "subscribe", n: 2, id: "a1b2c3d4e5f6", name: "iPhone", sub: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: newPhone().keys } });
  await until(() => own.heard.some((m) => m.n === 2), "an Android address is refused");
  assert.match(own.heard.find((m) => m.n === 2)!.error!, /iPhone/);
  await own.say({ t: "subscribe", n: 3, id: "ffffffffffff", name: "Other", sub: { endpoint: "https://web.push.apple.com/zzz", keys: newPhone().keys } });
  await until(() => own.heard.some((m) => m.n === 3), "another id is refused");
  assert.equal(own.heard.find((m) => m.n === 3)!.ok, false);
  const ph = newPhone();
  await own.say({ t: "subscribe", n: 4, id: "a1b2c3d4e5f6", name: "iPhone", sub: { endpoint: "https://web.push.apple.com/abc", keys: ph.keys } });
  await until(() => own.heard.some((m) => m.n === 4 && m.ok), "alerts on");
  await until(() => pushes.length === 1, "Alerts are on");
  assert.equal(JSON.parse(unlockOnPhone(pushes[0].body, ph.ecdh, ph.auth)).title, "Alerts are on");
  assert.equal(s.snapshot().link!.phones[0].alerts, true);

  // A chat asks; away: the iPhone buzzes, locked for it alone, and sees no folder paths.
  const waiting = askStation({ agent: "claude", session_id: "c1", cwd: "/Users/ana/billing", tool_name: "Bash", tool_input: { command: "npm test" } });
  await until(() => own.heard.some((m) => m.t === "state" && m.state!.pending.length === 1), "the request reaches the iPhone");
  const st = own.heard.filter((m) => m.t === "state").at(-1)!.state!;
  assert.ok(!JSON.stringify(st).includes("/Users/ana"), "no folder paths on the iPhone");
  await until(() => pushes.length === 2, "the request's alert");
  const note = JSON.parse(unlockOnPhone(pushes[1].body, ph.ecdh, ph.auth)) as { body: string; kind: string; id: string };
  assert.equal(note.kind, "request");
  assert.match(note.body, /npm test/);
  assert.ok(!pushes[1].body.toString("latin1").includes("npm test"), "Apple sees no words");
  await own.say({ t: "decide", n: 5, id: note.id, decision: "allow" });
  assert.equal((await waiting)?.decision, "allow");

  // "Alert my phone always" off and at the Mac: no buzz unless it still waits a little later.
  await s.setSettings({ phoneAlways: false });
  away = false;
  const second = askStation({ agent: "claude", session_id: "c2", cwd: "/p/api", tool_name: "Bash", tool_input: { command: "ls" } });
  await until(() => s.snapshot().pending.length === 1, "the second request");
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(pushes.length, 2, "no buzz while you're at the Mac");
  s.decide(s.snapshot().pending[0].id, { decision: "deny" });
  await second;
  await s.setSettings({ phoneAlways: true });
  const third = askStation({ agent: "claude", session_id: "c3", cwd: "/p/web", tool_name: "Bash", tool_input: { command: "pwd" } });
  await until(() => pushes.length === 3, "with Alert my phone always on, at once");
  s.decide(s.snapshot().pending[0].id, { decision: "allow" });
  await third;

  // What an iPhone can't do, and what a wrong key gets.
  await own.say({ t: "ask", n: 9, text: "read my Downloads folder" });
  await own.say({ t: "settings", n: 10, approvals: false });
  const stranger = await openBox(randomB64u(32));
  own.ws.send(JSON.stringify({ k: "msg", d: await seal(stranger, { t: "decide", n: 11, id: note.id, decision: "allow" }) }));
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(!own.heard.some((m) => m.n === 9 || m.n === 10 || m.n === 11));
  assert.equal(s.snapshot().settings.approvals, true);

  // Unlink this iPhone, on the iPhone: ended on both sides.
  await own.say({ t: "forget", id: "a1b2c3d4e5f6" });
  await until(() => !s.snapshot().link!.linked, "unlinked on the Mac");
  assert.equal(await relay.room(paired.room!).logic.check(own.box.token), 410);
});

test("the Mac sends its state only while the iPhone app is open", async () => {
  const relay = memoryRelay();
  station = newStation(relay, []);
  await station.start();
  const s = station;
  const { own, paired } = await pairIPhone(s, relay);
  const room = relay.room(paired.room!);
  own.ws.close();
  await new Promise((r) => setTimeout(r, 50));
  const before = room.data.get("state");
  s.sample();
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(room.data.get("state"), before, "nothing is sent while no iPhone looks");
  const back = await phoneOn(relay, paired.room!, paired.secret!);
  await until(() => back.ws.readyState === 1, "the app opens again");
  await until(() => back.heard.some((m) => m.t === "state" && m.state!.pending.length === 1), "it sees the request at once");
});

test("Test on the Mac: a pretend request reaches the iPhone at once, and the answer comes back", async () => {
  const relay = memoryRelay();
  const pushes: { body: Buffer }[] = [];
  station = newStation(relay, pushes, { away: () => false });
  await station.start();
  const s = station;
  const { own } = await pairIPhone(s, relay);
  assert.deepEqual(await s.link!.sample(), [], "no alerts yet: nothing sent, and the caller says so");
  const ph = newPhone();
  await own.say({ t: "subscribe", n: 2, id: "a1b2c3d4e5f6", name: "iPhone", sub: { endpoint: "https://web.push.apple.com/abc", keys: ph.keys } });
  await until(() => pushes.length === 1, "the hello alert");
  const reports = await s.link!.sample();
  assert.deepEqual(reports, [{ name: "iPhone", ok: true, status: 201 }]);
  const note = JSON.parse(unlockOnPhone(pushes[1].body, ph.ecdh, ph.auth)) as { kind: string; id: string };
  assert.equal(note.kind, "request");
  await own.say({ t: "decide", n: 3, id: note.id, decision: "always" });
  await until(() => s.snapshot().test?.answer === "always", "the answer reaches the Mac");
  assert.equal(s.snapshot().test?.from, "phone");
  assert.ok(!fs.existsSync(path.join(process.env.AIRBAND_HOME!, "station-rules.json")), "a test's Always remembers nothing");
  await own.say({ t: "test", n: 4 });
  await until(() => own.heard.some((m) => m.n === 4 && m.ok), "Send me a test alert");
  assert.equal(JSON.parse(unlockOnPhone(pushes.at(-1)!.body, ph.ecdh, ph.auth)).title, "Test from your Mac");
});

test("a link from the first version with no iPhone is cleaned up; one with an iPhone carries over", async () => {
  const home = process.env.AIRBAND_HOME!;
  const file = path.join(home, "phone-link.json");
  const vapid = newVapidKeys();
  fs.writeFileSync(file, JSON.stringify({ room: randomB64u(16), secret: randomB64u(32), vapid, phones: [] }));
  const relay = memoryRelay();
  station = newStation(relay, []);
  await station.start();
  assert.deepEqual(station.snapshot().link, { linked: false, online: false, phones: [] }, "no half link");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).vapid.publicKey, vapid.publicKey, "the alert key stays");
  await station.stop();
  fs.writeFileSync(file, JSON.stringify({ room: randomB64u(16), secret: randomB64u(32), vapid, phones: [{ id: "a1b2c3d4e5f6", name: "iPhone", at: 1, push: { endpoint: "https://web.push.apple.com/x", keys: newPhone().keys } }] }));
  station = newStation(relay, []);
  await station.start();
  assert.equal(station.snapshot().link!.linked, true);
  assert.deepEqual(station.snapshot().link!.phones.map((p) => [p.name, p.alerts]), [["iPhone", true]]);
});
