// Airband's own settings, kept in ~/.airband/config.json so the hook and the command line read
// what the extension set (they can't read VS Code's settings).
import { airbandFile, writeFileAtomic } from "./paths";
import { readJson } from "./json";

export type ContextSize = "compact" | "standard" | "full";
/** Characters of conversation sent on connecting (tokens ≈ chars / 4). */
export const CONTEXT_BUDGET: Record<ContextSize, number> = { compact: 8_000, standard: 24_000, full: 60_000 };

/** Airband's settings the hook needs too (it can't read VS Code's). */
export interface AirbandConfig {
  contextSize: ContextSize;
  /** Deliver waiting updates as soon as a chat finishes a reply (not only with its next message). */
  autoDeliver: boolean;
  /** Show the person a short line when a chat starts and when other chats' work rides along. */
  notices: boolean;
  /** Writing rules a chat gets when it needs them: docs, messages, and short replies. */
  writing: { docs: boolean; messages: boolean; replies: boolean; beforeSend: boolean };
}

export function readConfig(): AirbandConfig {
  const c = readJson<Partial<AirbandConfig>>(airbandFile("config.json"), {});
  // Delivering at once costs the chat an extra turn, so it is off unless chosen.
  return {
    contextSize: c.contextSize && c.contextSize in CONTEXT_BUDGET ? c.contextSize : "standard",
    autoDeliver: c.autoDeliver === true,
    // On unless turned off: they tell the person Airband is working, at no token cost.
    notices: c.notices !== false,
    // Docs and message rules come only with an ask for one, a few lines once per chat: on.
    // Short replies change how every reply reads: off unless chosen.
    writing: { docs: c.writing?.docs !== false, messages: c.writing?.messages !== false, replies: c.writing?.replies === true, beforeSend: c.writing?.beforeSend !== false },
  };
}

/** Changes some of Airband's settings in config.json, keeping the rest. (VS Code's own settings,
 *  when the extension runs, are mirrored here too and win on its next start.) */
export function setConfig(patch: Partial<AirbandConfig>): AirbandConfig {
  const file = airbandFile("config.json");
  const next = { ...readJson<Partial<AirbandConfig>>(file, {}), ...patch };
  writeFileAtomic(file, JSON.stringify(next));
  return readConfig();
}
