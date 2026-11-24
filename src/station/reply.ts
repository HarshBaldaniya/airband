// What the hook prints back to an agent after a person answered a permission request in the
// Airband app or on their phone. The one rule: nothing that allows anything is printed
// without a decision a person clicked. No decision prints nothing, and the agent then asks in its
// own terminal, exactly as if Airband were not there.
//
// The reply shapes follow Claude Code's documented PermissionRequest output, which Codex shares.
// Coucou (MIT, github.com/louis-cfm/coucou) showed which agents read which shape.

import { createHash } from "node:crypto";

/** What the person chose. "terminal" means: let the agent ask in its own window. */
export type Decision = "allow" | "always" | "deny" | "terminal";

export interface Answer {
  decision: Decision;
  /** AskUserQuestion: each question's text, mapped to the label picked (or labels, for multi-select). */
  answers?: Record<string, string | string[]>;
  /** Deny: what the agent is told. */
  message?: string;
}

/** What the agent is told when the person says no, or skips its question. */
export const DENIED = "The person said no from Airband.";
export const SKIPPED_QUESTION = "The person skipped this question from Airband. Carry on with your best judgement, and say what you assumed.";

/** The agents whose permission requests Airband can answer. Gemini CLI has no such hook. */
const TAKES_DECISIONS = ["claude", "codex"] as const;
export type DecidingAgent = (typeof TAKES_DECISIONS)[number];

export interface QuestionOption {
  label: string;
  description?: string;
}
export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

/** The questions of an AskUserQuestion request, when that is what is being asked. */
export function questionsOf(toolName: string | undefined, input: unknown): Question[] | undefined {
  if (toolName !== "AskUserQuestion" || !input || typeof input !== "object") return undefined;
  const qs = (input as { questions?: unknown }).questions;
  if (!Array.isArray(qs) || !qs.length) return undefined;
  const out: Question[] = [];
  for (const q of qs) {
    if (!q || typeof q !== "object") return undefined;
    const { question, header, options, multiSelect } = q as Record<string, unknown>;
    if (typeof question !== "string" || !Array.isArray(options)) return undefined;
    const opts = options
      .map((o) => (o && typeof o === "object" ? (o as Record<string, unknown>) : {}))
      .filter((o) => typeof o.label === "string")
      .map((o) => ({ label: o.label as string, ...(typeof o.description === "string" ? { description: o.description } : {}) }));
    out.push({ question, ...(typeof header === "string" ? { header } : {}), options: opts, ...(multiSelect === true ? { multiSelect: true } : {}) });
  }
  return out;
}

/** True when `answers` answers exactly the questions asked: one entry per question, each a label it offered. */
export function answersFit(questions: Question[], answers: Record<string, string | string[]>): boolean {
  if (!questions.length || Object.keys(answers).length !== questions.length) return false;
  return questions.every((q) => {
    const labels = q.options.map((o) => o.label);
    const pick = answers[q.question];
    if (q.multiSelect) {
      if (!Array.isArray(pick) || !pick.length || new Set(pick).size !== pick.length) return false;
      return pick.every((p) => labels.includes(p));
    }
    return typeof pick === "string" && labels.includes(pick);
  });
}

/** The line to print for a permission request, given the person's answer (none: print nothing). */
export function permissionReply(agent: string, toolName: string | undefined, input: unknown, answer: Answer | undefined): string | undefined {
  if (!answer || !(TAKES_DECISIONS as readonly string[]).includes(agent)) return undefined;
  const wrap = (decision: Record<string, unknown>) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PermissionRequest", decision } });
  switch (answer.decision) {
    case "allow":
    case "always": {
      const questions = agent === "claude" ? questionsOf(toolName, input) : undefined;
      if (questions) {
        // A question is only ever answered with what it offered; anything else lets the agent ask.
        if (!answer.answers || !answersFit(questions, answer.answers)) return undefined;
        return wrap({ behavior: "allow", updatedInput: { ...(input as object), answers: answer.answers } });
      }
      return wrap({ behavior: "allow" });
    }
    case "deny": {
      // A question turned down is a question skipped: the agent goes on without an answer.
      const said = (answer.message ?? "").trim() || (questionsOf(toolName, input) ? SKIPPED_QUESTION : DENIED);
      return wrap({ behavior: "deny", message: said });
    }
    default:
      return undefined;
  }
}

/** One line a person can read: what the agent wants to do. */
export function describeRequest(toolName: string | undefined, input: unknown): { title: string; detail?: string } {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const name = toolName ?? "a tool";
  if (toolName === "Bash" || toolName === "shell" || toolName === "exec_command" || toolName === "local_shell") {
    const cmd = str(i.command) ?? (Array.isArray(i.command) ? (i.command as unknown[]).join(" ") : undefined) ?? str(i.cmd);
    return { title: "Wants to run a command", ...(cmd ? { detail: cmd } : {}) };
  }
  if (toolName === "Write" || toolName === "Edit" || toolName === "MultiEdit" || toolName === "NotebookEdit") {
    const file = str(i.file_path) ?? str(i.notebook_path);
    return { title: toolName === "Write" ? "Wants to write a file" : "Wants to edit a file", ...(file ? { detail: file } : {}) };
  }
  if (toolName === "WebFetch") return { title: "Wants to open a web page", ...(str(i.url) ? { detail: str(i.url) } : {}) };
  if (toolName === "WebSearch") return { title: "Wants to search the web", ...(str(i.query) ? { detail: str(i.query) } : {}) };
  if (toolName === "AskUserQuestion") {
    const first = questionsOf(toolName, input)?.[0]?.question;
    return { title: "Has a question for you", ...(first ? { detail: first } : {}) };
  }
  if (toolName === "ExitPlanMode") return { title: "Has a plan ready for you to approve", ...(str(i.plan) ? { detail: str(i.plan)!.slice(0, 400) } : {}) };
  if (toolName?.startsWith("mcp__")) {
    const [, server, tool] = toolName.split("__");
    return { title: `Wants to use ${tool ?? "a tool"} (${server ?? "MCP"})` };
  }
  return { title: `Wants to use ${name}` };
}

/**
 * What "always allow" remembers: the same tool with exactly the same input, in the same folder. The
 * whole input counts, not one field of it. A tool with no command or file (an MCP tool, a Task, a
 * search) would otherwise share one key for every call, and one "always" would allow them all.
 */
export function ruleKey(agent: string, cwd: string | undefined, toolName: string | undefined, input: unknown): string {
  const what = createHash("sha256").update(canonicalJson(input ?? null)).digest("base64url");
  return JSON.stringify([agent, cwd ?? "", toolName ?? "", what]);
}

/** JSON with every object's keys in order, so the same input always reads the same. */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}
