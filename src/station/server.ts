// The Station: a small local service that knows what every chat is doing, holds each permission
// request until the person answers it in the Airband app or on their phone, and passes messages to chats.
// It runs inside the Airband app (and as `airband station` without it). It listens on this computer
// only, unless the person turns on the phone link: then it also answers on the local network, and
// every request from there needs the phone's own key.
import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { airbandFile, readJson, safeId, statusDir, writeFileAtomic } from "../core/paths";
import { readHead } from "../core/record";
import { appendInbox } from "../core/store";
import type { Status } from "../core/types";
import { VERSION } from "../core/setup";
import { AGENT_NAME, forgetReads, liveChats, titleOf, type Agent, type LiveChat } from "./chats";
import { CatchUp } from "./catchup";
import { ChatWatch } from "./watch";
import { DECISION_MS, NONCE_HEADER, PROOF_HEADER, readStationInfo, stationFile, stationProof, type StationInfo } from "./client";
import { PHONE_LINK } from "./phone";
import { PhoneLink, type LinkStatus, type PhoneLinkOptions } from "./link";
import { cleanDesign, cleanName, DEFAULT_COMPANION, type CompanionSettings } from "./companion";
import { ask, headline, tellText, type CompanionAnswer } from "./manager";
import { openChat } from "./open";
import { chatApp } from "../core/apps";
import { describeRequest, questionsOf, ruleKey, type Answer, type Question } from "./reply";

const DEFAULT_PORT = 47821;

export interface PendingView {
  id: string;
  agent: Agent;
  agentName: string;
  chatId?: string;
  chatTitle: string;
  project: string;
  cwd?: string;
  toolName?: string;
  title: string;
  detail?: string;
  /** The detail was too long to show whole: only its first DETAIL_MAX characters are in `detail`. */
  truncated?: true;
  /** The whole detail's length, when it was cut. */
  detailLength?: number;
  questions?: Question[];
  at: number;
  expiresAt: number;
  /** A pretend request to try the phone link (Test in the settings): no chat waits on it. */
  sample?: true;
}

export interface FinishedView {
  chatId: string;
  title: string;
  project: string;
  agent: Agent;
  agentName: string;
  did?: string;
  open?: string;
  /** A summary for a notification, and whether the chat left the next step to you. */
  brief?: string;
  yours?: boolean;
  at: number;
}

export interface StationSettings {
  /** Permission requests come to the app. Off: every chat asks in its own terminal. */
  approvals: boolean;
  /** The phone link: the Station also answers on the local network. */
  phone: boolean;
  /** How long a request waits for a click before the terminal asks, in ms. */
  waitMs: number;
  /** The companion's name and look. */
  companion: CompanionSettings;
  /** Open questions may go to Claude Code (with Airband's records only). On unless turned off. */
  lookups: boolean;
  /** A linked phone hears every request and finished chat at once, even while you're at the computer.
   *  Off: only when you're away (the screen locked, or idle for a minute). */
  phoneAlways: boolean;
}

export interface StationState {
  version: string;
  now: number;
  headline: string;
  chats: LiveChat[];
  pending: PendingView[];
  finished: FinishedView[];
  settings: StationSettings;
  phoneUrl?: string;
  /** The phone link through Airband's relay: whether a phone is linked, and which. */
  link?: LinkStatus;
  /** How the latest test request was answered, and where ("none": nobody answered in time). */
  test?: { answer: string; from?: "phone" | "computer"; at: number };
}

export interface StationOptions {
  port?: number;
  /** Where the companion's screen (ui.js, ui.css) is. Default: next to this file, in companion/. */
  uiDir?: string;
  /** Opens a chat; default: its folder in VS Code, or a terminal. */
  open?: (chat: LiveChat) => string;
  /** Claude Code's command for open questions (null: records only). */
  claude?: string | null;
  pollMs?: number;
  now?: () => number;
  /** The phone link through the relay; false leaves it out (tests). */
  link?: PhoneLinkOptions | false;
  /** How often the records of big or quiet chats are caught up (0: never, for tests). */
  catchUpMs?: number;
  /** How often chat files whose hook doesn't run are looked at (0: never, for tests). */
  watchMs?: number;
}

interface Waiting extends PendingView {
  reply: (a: Answer | undefined) => void;
  /** What the agent asked to run or change: kept for "always allow", never shown in full. */
  toolInput?: unknown;
}

const settingsFile = () => airbandFile("station-settings.json");
const rulesFile = () => airbandFile("station-rules.json");
const phoneKeyFile = () => airbandFile("station-phone.json");
const FINISHED_KEEP_MS = 2 * 3600e3;
/** The most of a request's detail (a command, a plan) a screen is sent. Longer ones say they were cut. */
export const DETAIL_MAX = 2000;
/** A chat first seen already done counts as just finished if it stopped this recently. */
const JUST_FINISHED_MS = 2 * 60_000;
/** How long a one-time link to the companion's screen works. */
const ONE_TIME_MS = 2 * 60_000;
const SOMETHING_WRONG = "Something went wrong in Airband's Station. Try again.";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MIME: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

const defaultSettings = (): StationSettings => ({ approvals: true, phone: false, waitMs: DECISION_MS, companion: { ...DEFAULT_COMPANION }, lookups: true, phoneAlways: true });

export function readSettings(): StationSettings {
  const saved = readJson<Partial<StationSettings>>(settingsFile(), {});
  return { ...defaultSettings(), ...saved, phone: PHONE_LINK && saved.phone === true, companion: { name: cleanName(saved.companion?.name), design: cleanDesign(saved.companion?.design) } };
}

// Adapters that are not the home network: virtual machines, containers, VPNs and tunnels. A phone on
// the Wi-Fi cannot reach them, so the phone link never names them (Windows lists several of these
// first: "vEthernet (WSL)", "VirtualBox Host-Only", ...).
const NOT_HOME = /vethernet|virtual|vmware|vbox|hyper-v|docker|wsl|veth|^br-|bridge|utun|^tun|^tap|wireguard|^wg|tailscale|zerotier|vpn|^awdl|^llw|loopback|bluetooth/i;
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
// The usual names of a real Wi-Fi or cable adapter on macOS, Windows and Linux.
const HOME_NAME = /^(en\d|wi-?fi|wlan|wlp|wl|ethernet|eth|enp|eno|ens)/i;

/** Picks the address a phone on the same Wi-Fi can reach, from `os.networkInterfaces()`. */
export function pickLanAddress(nets: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string | undefined {
  const found: { address: string; score: number }[] = [];
  for (const [name, list] of Object.entries(nets)) {
    if (NOT_HOME.test(name)) continue;
    for (const n of list ?? []) {
      if (n.family !== "IPv4" || n.internal || n.address.startsWith("169.254.")) continue;
      const score = (PRIVATE_V4.test(n.address) ? 4 : 0) + (HOME_NAME.test(name) ? 2 : 0) + (name === "en0" ? 1 : 0);
      found.push({ address: n.address, score });
    }
  }
  return found.sort((a, b) => b.score - a.score)[0]?.address;
}

/** This computer's address on the local network, for the phone link. */
export function lanAddress(): string | undefined {
  return pickLanAddress(os.networkInterfaces());
}

const key = () => crypto.randomBytes(18).toString("base64url");

export class Station extends EventEmitter {
  port = 0;
  readonly token = key();
  private phoneKey: string;
  private settings: StationSettings;
  private server?: http.Server;
  private pending = new Map<string, Waiting>();
  private finished = new Map<string, FinishedView>();
  private chats: LiveChat[] = [];
  private seen = new Map<string, Status>();
  private sse = new Set<http.ServerResponse>();
  private timers: NodeJS.Timeout[] = [];
  private watcher?: fs.FSWatcher;
  private watch?: ChatWatch;
  private changeTimer?: NodeJS.Timeout;
  private lastSent = "";
  private readonly uiDir: string;

  constructor(private readonly o: StationOptions = {}) {
    super();
    this.settings = readSettings();
    this.phoneKey = readJson<{ key?: string }>(phoneKeyFile(), {}).key ?? key();
    this.uiDir = o.uiDir ?? path.join(__dirname, "companion");
    // The phone link is Mac to iPhone only: offered on a Mac (or where a test asks for it).
    if (o.link !== false && (process.platform === "darwin" || o.link)) this.link = new PhoneLink(this, o.link ?? {});
  }

  /** The phone link through Airband's relay. */
  readonly link?: PhoneLink;
  private lastTest?: { answer: string; from?: "phone" | "computer"; at: number };
  /** Links to the companion's screen that work once: a code and when it runs out. */
  private codes = new Map<string, number>();
  private testFrom?: "phone" | "computer";

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  /** Starts listening, unless another Station already runs on this computer. */
  async start(): Promise<void> {
    const other = readStationInfo();
    if (other && other.pid !== process.pid && (await ping(other))) throw new Error(`Airband's Station already runs (process ${other.pid}).`);
    fs.mkdirSync(airbandFile(), { recursive: true });
    writeFileAtomic(phoneKeyFile(), JSON.stringify({ key: this.phoneKey }));
    await this.listen(this.o.port ?? DEFAULT_PORT);
    this.writeInfo();
    this.refresh(true);
    this.timers.push(setInterval(() => this.refresh(), this.o.pollMs ?? 4000));
    // Chats the hook leaves alone (big ones, quiet ones with no record yet), in every folder.
    const every = this.o.catchUpMs ?? 30_000;
    if (every > 0) {
      const catchUp = new CatchUp();
      const run = () =>
        void catchUp.sweep().then((n) => {
          if (!n) return;
          forgetReads();
          this.refresh(true);
        });
      this.timers.push(setTimeout(run, 3000));
      this.timers.push(setInterval(run, every));
    }
    // Chats whose hook doesn't run (an app that skips hooks, a hook that broke): their files.
    const watchEvery = this.o.watchMs ?? 2000;
    if (watchEvery > 0) {
      this.watch = new ChatWatch(() => {
        forgetReads();
        this.refresh();
      });
      this.watch.start();
      this.timers.push(setInterval(() => void this.watch?.tick(), watchEvery));
    }
    await this.link?.start();
    this.timers.push(setInterval(() => this.sse.forEach((r) => r.write(": ping\n\n")), 20_000));
    try {
      fs.mkdirSync(statusDir(), { recursive: true });
      this.watcher = fs.watch(statusDir(), () => {
        clearTimeout(this.changeTimer);
        this.changeTimer = setTimeout(() => this.refresh(), 150);
      });
    } catch {
      // The timer still catches every change, a little later.
    }
  }

  /** Listens on `port`; if it stays taken (another program has it), on any free one. */
  private async listen(port: number, tries = 6): Promise<void> {
    const host = this.settings.phone ? "0.0.0.0" : "127.0.0.1";
    for (let i = 0; ; i++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const server = http.createServer((req, res) => void this.handle(req, res));
          server.once("error", reject);
          server.listen(port, host, () => {
            server.off("error", reject);
            this.server = server;
            this.port = (server.address() as { port: number }).port;
            resolve();
          });
        });
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || port === 0) throw e;
        // Just let go of a moment ago (a restart, the phone link turned on): it is free again shortly.
        if (i >= tries) port = 0;
        else await new Promise((r) => setTimeout(r, 150));
      }
    }
  }

  /** Stops taking new connections at once; the ones open end by themselves. */
  private letGo(): void {
    const old = this.server;
    this.server = undefined;
    for (const r of this.sse) r.end();
    this.sse.clear();
    old?.close();
    old?.closeIdleConnections?.();
  }

  async stop(): Promise<void> {
    this.link?.stop();
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.watcher?.close();
    this.watch?.stop();
    clearTimeout(this.changeTimer);
    for (const w of [...this.pending.values()]) w.reply(undefined);
    const old = this.server;
    this.letGo();
    old?.closeAllConnections?.();
    const info = readStationInfo();
    if (info?.pid === process.pid) fs.rmSync(stationFile(), { force: true });
  }

  private writeInfo(): void {
    const info: StationInfo = { port: this.port, token: this.token, pid: process.pid, at: this.now(), approvals: this.settings.approvals, waitMs: this.settings.waitMs };
    writeFileAtomic(stationFile(), JSON.stringify(info));
  }

  // ---- what it knows ----

  /** Re-reads every chat; a chat that just finished joins the "finished" list. */
  refresh(first = false): void {
    const now = this.now();
    this.chats = liveChats(now);
    for (const c of this.chats) {
      const was = this.seen.get(c.id);
      // A brand-new chat is listed only once its first turn ends: seen for the first time already
      // done, and only just stopped, it finished now too.
      const justNew = was === undefined && now - c.since < JUST_FINISHED_MS;
      if (!first && c.status === "done" && (was === "working" || was === "waiting" || justNew)) {
        this.finished.set(c.id, { chatId: c.id, title: c.title, project: c.project, agent: c.agent, agentName: AGENT_NAME[c.agent], ...(c.lastDid ? { did: c.lastDid } : {}), ...(c.open ? { open: c.open } : {}), ...(c.lastBrief ? { brief: c.lastBrief } : {}), ...(c.yours ? { yours: true } : {}), at: now });
        this.emit("finished", this.finished.get(c.id));
      }
      if (c.status === "working" || c.status === "waiting") this.finished.delete(c.id);
      this.seen.set(c.id, c.status);
    }
    for (const [id, f] of this.finished) if (now - f.at > FINISHED_KEEP_MS) this.finished.delete(id);
    this.changed();
  }

  snapshot(): StationState {
    const pending = [...this.pending.values()].map(({ reply: _r, toolInput: _i, ...v }) => v).sort((a, b) => a.at - b.at);
    return {
      version: VERSION,
      now: this.now(),
      headline: headline(this.chats, pending, this.now()),
      chats: this.chats,
      pending,
      finished: [...this.finished.values()].sort((a, b) => b.at - a.at),
      settings: this.settings,
      ...(this.settings.phone ? { phoneUrl: this.phoneUrl() } : {}),
      ...(this.link ? { link: this.link.status() } : {}),
      ...(this.lastTest ? { test: this.lastTest } : {}),
    };
  }

  /** Tells every screen, once, after a burst of changes. */
  changed(): void {
    setImmediate(() => {
      const s = this.snapshot();
      const { now: _n, ...rest } = s;
      const text = JSON.stringify(rest);
      if (text === this.lastSent) return;
      this.lastSent = text;
      this.emit("change", s);
      const line = `data: ${JSON.stringify(s)}\n\n`;
      for (const r of this.sse) r.write(line);
    });
  }

  phoneUrl(): string | undefined {
    const ip = lanAddress();
    return ip ? `http://${ip}:${this.port}/phone?t=${this.phoneKey}` : undefined;
  }

  // ---- what it does ----

  /** A chat asks permission: held until the person answers, the wait runs out, or the chat goes. */
  permission(b: { agent?: string; session_id?: string; cwd?: string; tool_name?: string; tool_input?: unknown; waitMs?: number }, onGone?: (cancel: () => void) => void): Promise<Answer | undefined> {
    const agent = b.agent === "codex" ? "codex" : b.agent === "claude" ? "claude" : undefined;
    if (!this.settings.approvals || !agent) return Promise.resolve(undefined);
    const questions = agent === "claude" ? questionsOf(b.tool_name, b.tool_input) : undefined;
    if (!questions && this.rules().includes(ruleKey(agent, b.cwd, b.tool_name, b.tool_input))) return Promise.resolve({ decision: "allow" });
    const sid = b.session_id && safeId(b.session_id) ? b.session_id : undefined;
    const chat = sid ? this.chats.find((c) => c.id === sid) : undefined;
    const head = sid && !chat ? readHead(sid) : undefined;
    const cwd = b.cwd ?? chat?.cwd ?? head?.cwd;
    const d = describeRequest(b.tool_name, b.tool_input);
    const now = this.now();
    const wait = Math.max(5000, Math.min(b.waitMs ?? this.settings.waitMs, DECISION_MS));
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const finish = (a: Answer | undefined) => {
        if (!this.pending.has(id)) return;
        clearTimeout(timer);
        this.pending.delete(id);
        this.changed();
        resolve(a);
      };
      const timer = setTimeout(() => finish(undefined), wait);
      const view: Waiting = {
        id,
        agent,
        agentName: AGENT_NAME[agent],
        ...(sid ? { chatId: sid } : {}),
        chatTitle: chat?.title ?? (head ? titleOf(head) : cwd ? path.basename(cwd) : AGENT_NAME[agent]),
        project: cwd ? path.basename(cwd) : "no folder",
        ...(cwd ? { cwd } : {}),
        ...(b.tool_name ? { toolName: b.tool_name } : {}),
        title: d.title,
        ...(d.detail ? { detail: d.detail.slice(0, DETAIL_MAX) } : {}),
        ...(d.detail && d.detail.length > DETAIL_MAX ? { truncated: true as const, detailLength: d.detail.length } : {}),
        ...(questions ? { questions } : {}),
        at: now,
        expiresAt: now + wait,
        reply: finish,
        toolInput: b.tool_input,
      };
      this.pending.set(id, view);
      onGone?.(() => finish(undefined));
      this.changed();
      const { reply: _r, toolInput: _i, ...shown } = view;
      this.emit("request", shown);
    });
  }

  /** The person's answer to a request. "always" also allows the same thing in that folder from now on. */
  /** A pretend request to try the phone link: it shows like a real one, and no chat waits on it. */
  sample(): PendingView {
    for (const w of this.pending.values()) if (w.sample) w.reply(undefined);
    const now = this.now();
    const id = crypto.randomUUID();
    const wait = 90_000;
    this.lastTest = undefined;
    const finish = (a: Answer | undefined) => {
      if (!this.pending.has(id)) return;
      clearTimeout(timer);
      this.pending.delete(id);
      this.lastTest = { answer: a?.decision ?? "none", ...(a && this.testFrom ? { from: this.testFrom } : {}), at: this.now() };
      this.changed();
    };
    const timer = setTimeout(() => finish(undefined), wait);
    const view: Waiting = { id, agent: "claude", agentName: "Airband", chatTitle: "Airband test", project: "test", title: "A test from your computer", detail: "Tap Allow or Deny. Nothing runs.", at: now, expiresAt: now + wait, reply: finish, sample: true };
    this.pending.set(id, view);
    this.changed();
    const { reply: _r, toolInput: _i, ...shown } = view;
    this.emit("request", shown);
    return shown;
  }

  decide(id: string, a: Answer, from: "phone" | "computer" = "computer"): boolean {
    const w = this.pending.get(id);
    if (!w) return false;
    if (w.sample) this.testFrom = from;
    if (a.decision === "always" && !w.questions && !w.sample) this.remember(ruleKey(w.agent, w.cwd, w.toolName, w.toolInput));
    w.reply(a);
    return true;
  }

  private rules(): string[] {
    return readJson<string[]>(rulesFile(), []);
  }

  /** Keeps "always allow" for this exact request: same agent, folder, tool and command or file. */
  remember(rule: string): void {
    const rules = this.rules();
    if (!rules.includes(rule)) writeFileAtomic(rulesFile(), JSON.stringify([...rules, rule].slice(-500)));
  }

  forgetRules(): void {
    writeFileAtomic(rulesFile(), "[]");
  }

  ask(text: string): Promise<CompanionAnswer> {
    const pending = [...this.pending.values()];
    return ask(text, {
      chats: this.chats,
      pending,
      tell: (id, t) => this.tell(id, t),
      open: (id) => this.open(id),
      decide: (id, decision) => this.decide(id, { decision }),
      lookups: this.settings.lookups,
      name: this.settings.companion.name,
      version: VERSION,
      ...(this.o.claude !== undefined ? { claude: this.o.claude } : {}),
      now: this.now(),
    });
  }

  /** Puts a message in a chat's inbox: Airband hands it over with the chat's next turn. */
  tell(chatId: string, text: string): string {
    if (!safeId(chatId) || !text.trim()) throw new Refusal(400, "Nothing to send.");
    const chat = this.chats.find((c) => c.id === chatId);
    const head = chat ? undefined : readHead(chatId);
    const title = chat?.title ?? (head ? titleOf(head) : chatId.slice(0, 8));
    appendInbox(chatId, { from: { id: "airband-app", tool: "Claude", title: "You, via the Airband app" }, at: this.now(), kind: "update", text: tellText(text.trim()) });
    return title;
  }

  /** When a message sent now reaches the chat, in words: at once while it works, else on its next turn. */
  tellWhen(chatId: string): string {
    const chat = this.chats.find((c) => c.id === chatId);
    if (chat?.status === "working") return chat.agent === "codex" ? "It gets it as this reply ends, and carries on with it." : "It gets it within seconds, while it works.";
    if (chat?.status === "waiting") return "It gets it once you answer what it is waiting for.";
    return "It gets it the next time it runs. Open it to send it on now.";
  }

  open(chatId: string): string {
    const chat = this.chats.find((c) => c.id === chatId);
    if (!chat) {
      const head = safeId(chatId) ? readHead(chatId) : undefined;
      if (!head) return "That chat is gone.";
      return (this.o.open ?? openChat)({ id: head.id, agent: head.tool, cwd: head.cwd, app: chatApp(head.tool, head.file), title: titleOf(head), project: "", status: "idle", updatedAt: head.updatedAt, since: head.updatedAt });
    }
    this.finished.delete(chatId);
    this.changed();
    return (this.o.open ?? openChat)(chat);
  }

  dismiss(chatId: string): void {
    if (this.finished.delete(chatId)) this.changed();
  }

  async setSettings(patch: Partial<StationSettings>): Promise<StationSettings> {
    if (!PHONE_LINK) patch = { ...patch, phone: false };
    const before = this.settings;
    this.settings = { ...before, ...patch };
    writeFileAtomic(settingsFile(), JSON.stringify(this.settings));
    if (patch.approvals === false) for (const w of [...this.pending.values()]) w.reply({ decision: "terminal" });
    if (before.phone !== this.settings.phone && this.server) {
      // The phone link changes where the Station listens: same port, now on the network or not.
      const port = this.port;
      this.letGo();
      await this.listen(port);
    }
    this.writeInfo();
    this.changed();
    return this.settings;
  }

  /** A new phone key: the old phone link stops working. */
  newPhoneKey(): void {
    this.phoneKey = key();
    writeFileAtomic(phoneKeyFile(), JSON.stringify({ key: this.phoneKey }));
    this.changed();
  }

  /**
   * A code for a link to the companion's screen that works once, within ONE_TIME_MS. Opening it
   * keeps the Station's key in the browser, so the key itself is never printed or shown in a URL.
   */
  oneTimeCode(): string {
    const now = this.now();
    for (const [c, until] of this.codes) if (until <= now) this.codes.delete(c);
    const code = key();
    this.codes.set(code, now + ONE_TIME_MS);
    return code;
  }

  private useCode(code: string): boolean {
    const until = this.codes.get(code);
    this.codes.delete(code);
    return until !== undefined && until > this.now();
  }

  // ---- HTTP ----

  private who(req: http.IncomingMessage, url: URL): "local" | "phone" | undefined {
    const loop = LOOPBACK.has(req.socket.remoteAddress ?? "");
    const cookie = /(?:^|;\s*)airband_t=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    const given = (req.headers["x-airband-token"] as string | undefined) ?? url.searchParams.get("t") ?? cookie;
    if (!given) return undefined;
    if (loop && safeEqual(given, this.token)) return "local";
    if ((loop || this.settings.phone) && safeEqual(given, this.phoneKey)) return "phone";
    return undefined;
  }

  /**
   * Only Roger's own pages and Airband's own programs reach the Station. A web page served from any
   * other address on this computer could otherwise send requests with the key the browser keeps
   * (approving a tool, telling a chat what to do): its Host, its Origin or its plain form gives it
   * away. A JSON body can't come from another page without the browser asking first, and the
   * Station never says yes.
   */
  private fromHere(req: http.IncomingMessage): boolean {
    const own = new Set([`127.0.0.1:${this.port}`, `localhost:${this.port}`]);
    const host = req.headers.host ?? "";
    if (!own.has(host) && !(this.settings.phone && host.endsWith(`:${this.port}`))) return false;
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) return false;
    if (req.method === "POST" && !/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return false;
    return true;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://station");
    const route = url.pathname;
    try {
      if (!this.fromHere(req)) return send(res, 403, { error: "Only Airband's own pages can reach the Station." });
      if (req.method === "GET" && route.startsWith("/ui/")) return this.asset(route.slice(4), res);
      const code = url.searchParams.get("c");
      if (req.method === "GET" && route === "/app" && code) {
        if (!this.useCode(code)) return send(res, 401, { error: "That link was used already or ran out. Make a new one with airband station." });
        res.writeHead(302, { location: "/app", "set-cookie": keyCookie(this.token), "cache-control": "no-store" });
        return void res.end();
      }
      const who = this.who(req, url);
      if (!who) return send(res, 401, { error: "This needs Airband's key." });
      // A hook checks that this answer comes from the Station that holds the key (client.ts).
      const nonce = req.headers[NONCE_HEADER];
      const proof = who === "local" && typeof nonce === "string" ? stationProof(this.token, nonce) : undefined;
      if (proof) res.setHeader(PROOF_HEADER, proof);
      if (route === "/api/hook/permission") {
        if (who !== "local" || req.method !== "POST") return send(res, 403, { error: "Only a chat on this computer can ask." });
        const body = await readBody(req);
        let cancel: (() => void) | undefined;
        res.on("close", () => !res.writableEnded && cancel?.());
        const answer = await this.permission(body as Parameters<Station["permission"]>[0], (c) => (cancel = c));
        return send(res, 200, answer ? { answer } : {});
      }
      if (req.method === "GET" && (route === "/app" || route === "/phone")) {
        const mode = route === "/phone" || who === "phone" ? "phone" : url.searchParams.get("mode") === "desktop" ? "desktop" : "phone";
        const t = url.searchParams.get("t");
        const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
        if (t) headers["set-cookie"] = keyCookie(t);
        res.writeHead(200, headers);
        return void res.end(page(mode));
      }
      if (req.method === "GET" && route === "/api/ping") return send(res, 200, { ok: true, version: VERSION });
      if (req.method === "GET" && route === "/api/state") return send(res, 200, this.snapshot());
      if (req.method === "GET" && route === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`data: ${JSON.stringify(this.snapshot())}\n\n`);
        this.sse.add(res);
        req.on("close", () => this.sse.delete(res));
        return;
      }
      if (req.method !== "POST") return send(res, 404, { error: "Not here." });
      const body = (await readBody(req)) as Record<string, unknown>;
      switch (route) {
        case "/api/decide": {
          const decision = body.decision as Answer["decision"];
          if (!["allow", "always", "deny", "terminal"].includes(decision)) return send(res, 400, { error: "Allow, always, deny or terminal." });
          const id = String(body.id ?? "");
          const ok = this.decide(id, { decision, ...(body.answers ? { answers: body.answers as Answer["answers"] } : {}), ...(typeof body.message === "string" ? { message: body.message } : {}) });
          return send(res, ok ? 200 : 410, ok ? { ok } : { error: "That request has already ended." });
        }
        // Asking and telling a chat are typed on the computer only: the phone link answers
        // requests and shows what finished, and nothing written on a phone reaches a chat.
        case "/api/ask":
          if (who !== "local") return send(res, 403, { error: "Ask on the computer." });
          return send(res, 200, await this.ask(String(body.text ?? "")));
        case "/api/tell":
          if (who !== "local") return send(res, 403, { error: "Message a chat from the computer." });
          {
            const id = String(body.chatId ?? "");
            return send(res, 200, { title: this.tell(id, String(body.text ?? "")), when: this.tellWhen(id) });
          }
        case "/api/open":
          return send(res, 200, { text: this.open(String(body.chatId ?? "")) });
        case "/api/dismiss":
          this.dismiss(String(body.chatId ?? ""));
          return send(res, 200, { ok: true });
        // Linking a phone happens on the computer only: the code it shows holds the pair's secret.
        case "/api/phone/link":
        case "/api/phone/code":
        case "/api/phone/test":
        case "/api/phone/unlink": {
          if (who !== "local") return send(res, 403, { error: "Link a phone from the computer." });
          if (!this.link) return send(res, 404, { error: "The phone link is off here." });
          if (route === "/api/phone/unlink") return await this.link.unlink(), send(res, 200, { ok: true });
          if (route === "/api/phone/test") return send(res, 200, { results: await this.link.sample() });
          const url = route === "/api/phone/link" ? await this.link.link() : this.link.pairingUrl();
          return send(res, 200, { url });
        }
        case "/api/settings": {
          if (who !== "local") return send(res, 403, { error: "Settings change on the computer only." });
          const patch: Partial<StationSettings> = {};
          if (typeof body.approvals === "boolean") patch.approvals = body.approvals;
          if (typeof body.phone === "boolean") patch.phone = body.phone;
          if (typeof body.lookups === "boolean") patch.lookups = body.lookups;
          if (typeof body.phoneAlways === "boolean") patch.phoneAlways = body.phoneAlways;
          if (typeof body.waitMs === "number") patch.waitMs = Math.max(5000, Math.min(body.waitMs, DECISION_MS));
          if (body.companionName !== undefined || body.companionDesign !== undefined)
            patch.companion = { name: body.companionName !== undefined ? cleanName(body.companionName) : this.settings.companion.name, design: body.companionDesign !== undefined ? cleanDesign(body.companionDesign) : this.settings.companion.design };
          return send(res, 200, await this.setSettings(patch));
        }
        default:
          return send(res, 404, { error: "Not here." });
      }
    } catch (e) {
      if (e instanceof Refusal) return void (!res.headersSent && send(res, e.status, { error: e.message }));
      // What went wrong stays in the Station's log: a page is told only that it did.
      console.error("airband station:", e);
      if (!res.headersSent) send(res, 500, { error: SOMETHING_WRONG });
    }
  }

  private asset(name: string, res: http.ServerResponse): void {
    const file = path.join(this.uiDir, path.basename(name));
    const type = MIME[path.extname(file)];
    if (!type || !fs.existsSync(file)) return send(res, 404, { error: "Not here." });
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  }
}

/** The browser keeps the key in a cookie no page script can read. */
const keyCookie = (t: string) => `airband_t=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`;

/** A request the Station turns down on purpose: its sentence is the person's to read. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function send(res: http.ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

function readBody(req: http.IncomingMessage, max = 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Refusal(413, "Too much."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Refusal(400, "Not JSON."));
      }
    });
    req.on("error", reject);
  });
}

function ping(info: Pick<StationInfo, "port" | "token">): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: info.port, path: "/api/ping", headers: { "x-airband-token": info.token }, timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
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
