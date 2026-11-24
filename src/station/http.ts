// The Station's door: every HTTP request comes through here. It checks the request comes from
// Airband's own pages and programs on this computer and carries the Station's key, then hands it to
// the Station. Every sentence a screen can be told back is in SAID.
import * as fs from "node:fs";
import type * as http from "node:http";
import * as path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { MiB } from "../core/units";
import { VERSION } from "../core/version";
import { NONCE_HEADER, PROOF_HEADER, stationProof } from "./client";
import type { PhoneLink } from "./link";
import type { Answer } from "./reply";
import { settingsPatch } from "./settings";
import type { CompanionAnswer, StationSettings, StationState } from "./types";

/** What a screen is told when the Station turns a request down. */
export const SAID = {
  notOurPage: "Only Airband's own pages can reach the Station.",
  needsKey: "This needs Airband's key.",
  linkUsed: "That link was used already or ran out. Make a new one with airband station.",
  notHere: "Not here.",
  decisions: "Allow, always, deny or terminal.",
  ended: "That request has already ended.",
  noPhoneLink: "The phone link is off here.",
  nothingToSend: "Nothing to send.",
  tooMuch: "Too much.",
  notJson: "Not JSON.",
  somethingWrong: "Something went wrong in Airband's Station. Try again.",
};

/** The largest request body the Station reads. */
const BODY_MAX = MiB;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MIME: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const DECISIONS = ["allow", "always", "deny", "terminal"];

/** A request the Station turns down on purpose: its sentence is the person's to read. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** What the door needs from the Station behind it (server.ts). */
export interface StationHost {
  readonly port: number;
  readonly token: string;
  readonly link?: PhoneLink;
  readonly currentSettings: StationSettings;
  useOneTimeCode(code: string): boolean;
  permission(b: Record<string, unknown>, onGone?: (cancel: () => void) => void): Promise<Answer | undefined>;
  snapshot(): StationState;
  addStream(res: http.ServerResponse, req: http.IncomingMessage): void;
  decide(id: string, a: Answer): boolean;
  ask(text: string): Promise<CompanionAnswer>;
  tell(chatId: string, text: string): string;
  tellWhen(chatId: string): string;
  open(chatId: string): string;
  dismiss(chatId: string): void;
  setSettings(patch: Partial<StationSettings>): StationSettings;
}

/** The browser keeps the key in a cookie no page script can read. */
const keyCookie = (t: string) => `airband_t=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`;

/** The request comes from this computer and carries the Station's key. */
function holdsKey(station: StationHost, req: http.IncomingMessage, url: URL): boolean {
  const cookie = /(?:^|;\s*)airband_t=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
  const given = (req.headers["x-airband-token"] as string | undefined) ?? url.searchParams.get("t") ?? cookie;
  return !!given && LOOPBACK.has(req.socket.remoteAddress ?? "") && safeEqual(given, station.token);
}

/**
 * Only Roger's own pages and Airband's own programs reach the Station. A web page served from any
 * other address on this computer could otherwise send requests with the key the browser keeps
 * (approving a tool, telling a chat what to do): its Host, its Origin or its plain form gives it
 * away. A JSON body can't come from another page without the browser asking first, and the
 * Station never says yes.
 */
function fromHere(station: StationHost, req: http.IncomingMessage): boolean {
  const own = new Set([`127.0.0.1:${station.port}`, `localhost:${station.port}`]);
  const host = req.headers.host ?? "";
  if (!own.has(host)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  if (req.method === "POST" && !/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return false;
  return true;
}

/** The Station's request handler. `uiDir` holds the companion's screen (ui.js, ui.css). */
export function stationHandler(station: StationHost, uiDir: string): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req, res) => void handle(station, uiDir, req, res);
}

async function handle(station: StationHost, uiDir: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://station");
  const route = url.pathname;
  try {
    if (!fromHere(station, req)) return send(res, 403, { error: SAID.notOurPage });
    if (req.method === "GET" && route.startsWith("/ui/")) return asset(uiDir, route.slice(4), res);
    const code = url.searchParams.get("c");
    if (req.method === "GET" && route === "/app" && code) {
      if (!station.useOneTimeCode(code)) return send(res, 401, { error: SAID.linkUsed });
      res.writeHead(302, { location: "/app", "set-cookie": keyCookie(station.token), "cache-control": "no-store" });
      return void res.end();
    }
    if (!holdsKey(station, req, url)) return send(res, 401, { error: SAID.needsKey });
    // A hook checks that this answer comes from the Station that holds the key (client.ts).
    const nonce = req.headers[NONCE_HEADER];
    const proof = typeof nonce === "string" ? stationProof(station.token, nonce) : undefined;
    if (proof) res.setHeader(PROOF_HEADER, proof);
    if (route === "/api/hook/permission") {
      if (req.method !== "POST") return send(res, 404, { error: SAID.notHere });
      const body = (await readBody(req)) as Record<string, unknown>;
      let cancel: (() => void) | undefined;
      res.on("close", () => !res.writableEnded && cancel?.());
      const answer = await station.permission(body, (c) => (cancel = c));
      return send(res, 200, answer ? { answer } : {});
    }
    if (req.method === "GET" && route === "/app") {
      // The Airband app asks for its corner; a browser (airband station) gets the full page.
      const mode = url.searchParams.get("mode") === "desktop" ? "desktop" : "phone";
      const t = url.searchParams.get("t");
      const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
      if (t) headers["set-cookie"] = keyCookie(t);
      res.writeHead(200, headers);
      return void res.end(page(mode));
    }
    if (req.method === "GET" && route === "/api/ping") return send(res, 200, { ok: true, version: VERSION });
    if (req.method === "GET" && route === "/api/state") return send(res, 200, station.snapshot());
    if (req.method === "GET" && route === "/api/events") return station.addStream(res, req);
    if (req.method !== "POST") return send(res, 404, { error: SAID.notHere });
    const body = (await readBody(req)) as Record<string, unknown>;
    switch (route) {
      case "/api/decide": {
        const decision = body.decision as Answer["decision"];
        if (!DECISIONS.includes(decision)) return send(res, 400, { error: SAID.decisions });
        const ok = station.decide(String(body.id ?? ""), { decision, ...(body.answers ? { answers: body.answers as Answer["answers"] } : {}), ...(typeof body.message === "string" ? { message: body.message } : {}) });
        return send(res, ok ? 200 : 410, ok ? { ok } : { error: SAID.ended });
      }
      case "/api/ask":
        return send(res, 200, await station.ask(String(body.text ?? "")));
      case "/api/tell": {
        const id = String(body.chatId ?? "");
        return send(res, 200, { title: station.tell(id, String(body.text ?? "")), when: station.tellWhen(id) });
      }
      case "/api/open":
        return send(res, 200, { text: station.open(String(body.chatId ?? "")) });
      case "/api/dismiss":
        station.dismiss(String(body.chatId ?? ""));
        return send(res, 200, { ok: true });
      case "/api/phone/link":
      case "/api/phone/code":
      case "/api/phone/test":
      case "/api/phone/unlink": {
        const link = station.link;
        if (!link) return send(res, 404, { error: SAID.noPhoneLink });
        if (route === "/api/phone/unlink") return await link.unlink(), send(res, 200, { ok: true });
        if (route === "/api/phone/test") return send(res, 200, { results: await link.sample() });
        return send(res, 200, { url: route === "/api/phone/link" ? await link.link() : link.pairingUrl() });
      }
      case "/api/settings":
        return send(res, 200, station.setSettings(settingsPatch(body, station.currentSettings)));
      default:
        return send(res, 404, { error: SAID.notHere });
    }
  } catch (e) {
    if (e instanceof Refusal) return void (!res.headersSent && send(res, e.status, { error: e.message }));
    // What went wrong stays in the Station's log: a page is told only that it did.
    console.error("airband station:", e);
    if (!res.headersSent) send(res, 500, { error: SAID.somethingWrong });
  }
}

/** One of the companion's own files, and nothing else: only a name, never a path. */
function asset(uiDir: string, name: string, res: http.ServerResponse): void {
  const file = path.join(uiDir, path.basename(name));
  const type = MIME[path.extname(file)];
  if (!type || !fs.existsSync(file)) return send(res, 404, { error: SAID.notHere });
  res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function send(res: http.ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, max = BODY_MAX): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Refusal(413, SAID.tooMuch));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Refusal(400, SAID.notJson));
      }
    });
    req.on("error", reject);
  });
}

/** The page the companion's screen and the phone load: the same app, told which one it is. */
function page(mode: "desktop" | "phone"): string {
  const phone = mode === "phone";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Airband">
<meta name="theme-color" content="#141416">
<title>Airband</title>
<link rel="stylesheet" href="/ui/ui.css">
</head>
<body class="${phone ? "phone" : "desktop"}">
<div id="root"></div>
<script>window.AIRBAND_MODE = ${JSON.stringify(mode)};</script>
<script src="/ui/ui.js"></script>
</body>
</html>`;
}
