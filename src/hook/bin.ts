// The hook's entry point: agents run dist/airband-hook.js on their events, with the event as JSON on
// stdin and the agent's id as the first argument. Only this file runs anything when loaded, so tests
// importing the hook's parts never read stdin or exit. It always exits 0, within 4 s, except for a
// permission request, which waits for the person's click.
import type { AgentId } from "../core/agents";
import { DECISION_MS } from "../station/client";
import { handle } from "./handle";
import type { HookInput } from "./input";
import { permission } from "./permission";
import { noteHookRan } from "../install/hook-health";

/** A permission request waits up to DECISION_MS for a click; this much more lets its answer be printed. */
const EXIT_GRACE_MS = 5_000;
/** Every other event is done well within this. */
const EVENT_MS = 4000;

function main(): void {
  const arg = (process.argv[2] ?? "claude").toLowerCase();
  const tool: AgentId = arg === "codex" || arg === "gemini" ? arg : "claude";
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    let input: HookInput;
    try {
      input = JSON.parse(raw) as HookInput;
    } catch {
      process.exit(0);
    }
    // The agent runs the hook: noted, so the doctor can tell an agent that skips it.
    noteHookRan(tool);
    if (input.hook_event_name === "PermissionRequest") {
      // The one event that waits for a person: the usual 4 s limit gives way to the app's own.
      clearTimeout(limit);
      setTimeout(() => process.exit(0), DECISION_MS + EXIT_GRACE_MS).unref();
      void permission(input, tool).then(
        (out) => {
          if (out) process.stdout.write(out);
          process.exit(0);
        },
        () => process.exit(0),
      );
      return;
    }
    try {
      const out = handle(input, Date.now(), tool);
      if (out) process.stdout.write(out);
    } catch {
      // Never interrupt anyone's chat.
    }
    process.exit(0);
  });
  const limit = setTimeout(() => process.exit(0), EVENT_MS);
  limit.unref();
}

main();
