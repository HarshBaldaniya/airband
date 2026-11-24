// The Station: a small local service that knows what every chat is doing, holds each permission
// request until the person answers it in the Airband app or on their phone, and passes messages to chats.
// It runs inside the Airband app (and as `airband station` without it). It listens on this computer
// only. A linked iPhone reaches it through Airband's relay (link.ts), never over the network.
import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { airbandFile, safeId, statusDir, writeFileAtomic } from "../core/paths";
import { readHead } from "../core/record";
import { appendInbox } from "../core/store";
import type { Status } from "../core/types";
import { VERSION } from "../core/version";
import { AGENTS } from "../core/agents";
import { forgetReads, liveChats, titleOf, type LiveChat } from "./chats";
import { CatchUp } from "./catchup";
import { ChatWatch } from "./watch";
import { DECISION_MS, readStationInfo, stationAnswers, stationFile, type StationInfo } from "./client";
import { PhoneLink, type PhoneLinkOptions } from "./link";
import { ask, headline, tellText } from "./manager";
import { openChat } from "./open";
import { chatApp } from "../core/apps";
import { describeRequest, questionsOf, ruleKey, type Answer } from "./reply";
import type { CompanionAnswer, FinishedView, PendingView, StationSettings, StationState } from "./types";
import { HOUR_MS } from "../core/units";
import { Refusal, SAID, stationHandler } from "./http";
import { readRules, rememberRule } from "./rules";
import { readSettings, saveSettings, WAIT_MIN_MS } from "./settings";

const DEFAULT_PORT = 47821;

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

const FINISHED_KEEP_MS = 2 * HOUR_MS;
/** The most of a request's detail (a command, a plan) a screen is sent. Longer ones say they were cut. */
export const DETAIL_MAX = 2000;
/** A chat first seen already done counts as just finished if it stopped this recently. */
const JUST_FINISHED_MS = 2 * 60_000;
/** How long a pretend request (Test in the settings) waits for an answer. */
const SAMPLE_MS = 90_000;
/** How long a one-time link to the companion's screen works. */
const ONE_TIME_MS = 2 * 60_000;
/** A comment line on every open event stream this often, so nothing in between closes it as idle. */
const SSE_PING_MS = 20_000;

const key = () => crypto.randomBytes(18).toString("base64url");

export class Station extends EventEmitter {
  port = 0;
  readonly token = key();
  private settings: StationSettings;
  private server?: http.Server;
  private pending = new Map<string, Waiting>();
  private finished = new Map<string, FinishedView>();
  private chats: LiveChat[] = [];
  private seen = new Map<string, Status>();
  private streams = new Set<http.ServerResponse>();
  private timers: NodeJS.Timeout[] = [];
  private watcher?: fs.FSWatcher;
  private watch?: ChatWatch;
  private changeTimer?: NodeJS.Timeout;
  private lastSent = "";
  private readonly uiDir: string;

  constructor(private readonly o: StationOptions = {}) {
    super();
    this.settings = readSettings();
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
    if (other && other.pid !== process.pid && (await stationAnswers(other))) throw new Error(`Airband's Station already runs (process ${other.pid}).`);
    fs.mkdirSync(airbandFile(), { recursive: true });
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
    this.timers.push(setInterval(() => this.streams.forEach((r) => r.write(": ping\n\n")), SSE_PING_MS));
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
    for (let i = 0; ; i++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const server = http.createServer(stationHandler(this, this.uiDir));
          server.once("error", reject);
          server.listen(port, "127.0.0.1", () => {
            server.off("error", reject);
            this.server = server;
            this.port = (server.address() as { port: number }).port;
            resolve();
          });
        });
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE" || port === 0) throw e;
        // Just let go of a moment ago (a restart): it is free again shortly.
        if (i >= tries) port = 0;
        else await new Promise((r) => setTimeout(r, 150));
      }
    }
  }

  /** Stops taking new connections at once; the ones open end by themselves. */
  private letGo(): void {
    const old = this.server;
    this.server = undefined;
    for (const r of this.streams) r.end();
    this.streams.clear();
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
        this.finished.set(c.id, { chatId: c.id, title: c.title, project: c.project, agent: c.agent, agentName: AGENTS[c.agent].name, ...(c.lastDid ? { did: c.lastDid } : {}), ...(c.open ? { open: c.open } : {}), ...(c.lastBrief ? { brief: c.lastBrief } : {}), ...(c.yours ? { yours: true } : {}), at: now });
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
      ...(this.link ? { link: this.link.status() } : {}),
      ...(this.lastTest ? { test: this.lastTest } : {}),
    };
  }

  /** A screen's event stream: it gets the state now and after every change, until it closes. */
  addStream(res: http.ServerResponse, req: http.IncomingMessage): void {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify(this.snapshot())}\n\n`);
    this.streams.add(res);
    req.on("close", () => this.streams.delete(res));
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
      for (const r of this.streams) r.write(line);
    });
  }

  // ---- what it does ----

  /** A chat asks permission: held until the person answers, the wait runs out, or the chat goes. */
  permission(b: { agent?: string; session_id?: string; cwd?: string; tool_name?: string; tool_input?: unknown; waitMs?: number }, onGone?: (cancel: () => void) => void): Promise<Answer | undefined> {
    const agent = b.agent === "codex" ? "codex" : b.agent === "claude" ? "claude" : undefined;
    if (!this.settings.approvals || !agent) return Promise.resolve(undefined);
    const questions = agent === "claude" ? questionsOf(b.tool_name, b.tool_input) : undefined;
    if (!questions && readRules().includes(ruleKey(agent, b.cwd, b.tool_name, b.tool_input))) return Promise.resolve({ decision: "allow" });
    const sid = b.session_id && safeId(b.session_id) ? b.session_id : undefined;
    const chat = sid ? this.chats.find((c) => c.id === sid) : undefined;
    const head = sid && !chat ? readHead(sid) : undefined;
    const cwd = b.cwd ?? chat?.cwd ?? head?.cwd;
    const d = describeRequest(b.tool_name, b.tool_input);
    const now = this.now();
    const wait = Math.max(WAIT_MIN_MS, Math.min(b.waitMs ?? this.settings.waitMs, DECISION_MS));
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
        agentName: AGENTS[agent].name,
        ...(sid ? { chatId: sid } : {}),
        chatTitle: chat?.title ?? (head ? titleOf(head) : cwd ? path.basename(cwd) : AGENTS[agent].name),
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

  /** A pretend request to try the phone link: it shows like a real one, and no chat waits on it. */
  sample(): PendingView {
    for (const w of this.pending.values()) if (w.sample) w.reply(undefined);
    const now = this.now();
    const id = crypto.randomUUID();
    const wait = SAMPLE_MS;
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
    if (a.decision === "always" && !w.questions && !w.sample) rememberRule(ruleKey(w.agent, w.cwd, w.toolName, w.toolInput));
    w.reply(a);
    return true;
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
    if (!safeId(chatId) || !text.trim()) throw new Refusal(400, SAID.nothingToSend);
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

  get currentSettings(): StationSettings {
    return this.settings;
  }

  setSettings(patch: Partial<StationSettings>): StationSettings {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    if (patch.approvals === false) for (const w of [...this.pending.values()]) w.reply({ decision: "terminal" });
    this.writeInfo();
    this.changed();
    return this.settings;
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

  /** True once for a code oneTimeCode made, while it still works. */
  useOneTimeCode(code: string): boolean {
    const until = this.codes.get(code);
    this.codes.delete(code);
    return until !== undefined && until > this.now();
  }


}
