// Each agent's account and plan limits, as the agent reports them, for the Fuel page and the
// sidebar's foot.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { recentRollouts } from "../adapters/codex";
import type { Tool } from "../core/agents";
import { readTail } from "../core/file-lines";
import { codexSessionsDir } from "../core/paths";
import { findClaude } from "../core/process";
import type { PlanUsage } from "../core/types";
import { hookTargets } from "../install/agent-hooks";
import { claudePlanFrom, codexPlanFrom, geminiPlan, type ClaudeUsageAnswer } from "../sessions/plans";
import type { Controller } from "./controller";

/** Plan limits are read again at most this often (a Refresh on the Fuel page reads them at once). */
const PLANS_MS = 5 * 60_000;
/** Claude Code gets this long to say what the account and its limits are. */
const CLAUDE_ANSWER_MS = 20_000;

export class PlansService {
  /** The latest each agent reported. */
  current: Partial<Record<Tool, PlanUsage>> = {};
  loading = false;
  private at = 0;
  private codexMtime = 0;

  constructor(private readonly app: Controller) {}

  /**
   * Each agent's account and plan limits, as the agent reports them: Claude's from the person's own
   * Claude Code (its /usage data; nothing is sent to a model and no login is touched), Codex's from
   * its own chat records, Gemini CLI's sign-in. Read at most every five minutes unless asked.
   */
  async refresh(force = false): Promise<void> {
    if (this.loading || (!force && Date.now() - this.at < PLANS_MS)) return;
    this.loading = true;
    this.at = Date.now();
    if (force) this.app.post({ type: "state", state: { ...this.app.state, plansLoading: true } });
    const next: Partial<Record<Tool, PlanUsage>> = {};
    try {
      // An agent counts once it is installed (its home folder exists), even before its first chat, so
      // its card can say what to do next.
      const present = new Set<Tool>([...this.app.chats.adapters.filter((a) => a.tool === "Claude" || a.present()).map((a) => a.tool), ...hookTargets().filter((t) => t.present()).map((t) => t.tool)]);
      const exe = findClaude();
      if (exe) {
        try {
          next.Claude = await this.claudePlan(exe);
        } catch (err) {
          next.Claude = { tool: "Claude", windows: [], at: Date.now(), source: "Claude Code", note: `Claude Code didn't answer: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
      if (present.has("Codex")) next.Codex = this.codexPlan();
      if (present.has("Gemini")) next.Gemini = geminiPlan();
      this.current = next;
    } finally {
      this.loading = false;
      this.app.refreshSoon(0);
    }
  }

  /** Codex's limits, from the newest of its chat files that records them (a tail read each). */
  private codexPlan(): PlanUsage {
    let found: PlanUsage | undefined;
    const rollouts = recentRollouts(codexSessionsDir(), 25);
    this.codexMtime = rollouts[0]?.mtime ?? 0;
    for (const { file } of rollouts) if ((found = codexPlanFrom(readTail(file, 256 * 1024)))) break;
    // Whether Codex is signed in is told by its auth file being there; Airband never opens it.
    const signedIn = fs.existsSync(path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "auth.json"));
    return (
      found ?? {
        tool: "Codex",
        windows: [],
        at: Date.now(),
        source: "Codex",
        note: signedIn ? "Codex shows its limits after its first reply. Use Codex once, and they appear here." : "Sign in to Codex (run codex login in a terminal), use it once, and its limits appear here.",
      }
    );
  }

  /**
   * Codex writes its limits into each chat file as it answers, so they're read again the moment its
   * newest chat file changes, not on the five-minute cycle Claude's need. One folder listing, no more.
   */
  follow(): void {
    if (this.loading || !this.app.chats.adapters.some((a) => a.tool === "Codex" && a.present())) return;
    const newest = recentRollouts(codexSessionsDir(), 1)[0]?.mtime ?? 0;
    if (!newest || newest <= this.codexMtime) return;
    this.current = { ...this.current, Codex: this.codexPlan() };
  }

  private async claudePlan(exe: string): Promise<PlanUsage> {
    const abort = new AbortController();
    const never = (async function* () {
      await new Promise(() => undefined);
    })();
    const q = query({ prompt: never as AsyncIterable<never>, options: { pathToClaudeCodeExecutable: exe, cwd: this.app.root, persistSession: false, abortController: abort, settingSources: [] } });
    try {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no answer in time")), CLAUDE_ANSWER_MS));
      const account = await Promise.race([q.accountInfo(), timeout]);
      // The /usage data is marked experimental in the SDK: if it changes or goes, the account still shows.
      let usage: ClaudeUsageAnswer | undefined;
      try {
        const ask = (q as unknown as { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (o: { skipBehaviors: boolean }) => Promise<ClaudeUsageAnswer> })
          .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
        if (ask) usage = await Promise.race([ask.call(q, { skipBehaviors: true }), timeout]);
      } catch {
        usage = undefined;
      }
      return claudePlanFrom(account, usage);
    } finally {
      abort.abort();
    }
  }
}
