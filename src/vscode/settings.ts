// Airband's settings in VS Code, what the Writing page shows of them, and the copy the hook reads.
import * as vscode from "vscode";
import { CONTEXT_BUDGET, type ContextSize } from "../core/config";
import { readJson } from "../core/json";
import { airbandFile, writeFileAtomic } from "../core/paths";
import type { WritingView } from "../core/protocol";
import { claudeAiCreditShown } from "../install/agent-hooks";
import { projectFile } from "../writing/settings";

const config = () => vscode.workspace.getConfiguration("airband");

/** How much of a conversation goes over on connecting: the `airband.contextSize` setting. */
export function contextSize(): ContextSize {
  const v = config().get<string>("contextSize", "standard");
  return (v in CONTEXT_BUDGET ? v : "standard") as ContextSize;
}

function writingSettings(): WritingView["settings"] {
  const cfg = config();
  return { docs: cfg.get<boolean>("writing.docs", true), messages: cfg.get<boolean>("writing.messages", true), replies: cfg.get<boolean>("writing.replies", false), beforeSend: cfg.get<boolean>("writing.beforeSend", true) };
}

/** What the Writing page shows: the switches, and any project file that overrides them. */
export function writingView(): WritingView {
  const projects = (vscode.workspace.workspaceFolders ?? []).flatMap((f) => {
    const file = projectFile(f.uri.fsPath);
    if (!file) return [];
    const team = readJson<{ writing?: Record<string, unknown> }>(file, {}).writing ?? {};
    const pick = (k: string) => (typeof team[k] === "boolean" ? { [k]: team[k] as boolean } : {});
    return [{ name: f.name, team: { ...pick("docs"), ...pick("messages"), ...pick("replies"), ...pick("beforeSend") } }];
  });
  return { settings: writingSettings(), claudeAiCredit: claudeAiCreditShown(), projects };
}

/** Turns one writing rule on or off. VS Code's setting is the source; the hook's copy follows. */
export async function setWriting(key: keyof WritingView["settings"], on: boolean): Promise<void> {
  await config().update(`writing.${key}`, on, vscode.ConfigurationTarget.Global);
  syncConfig();
}

/** The hook can't read VS Code's settings, so the ones it needs are mirrored to ~/.airband/config.json. */
export function syncConfig(): void {
  try {
    const cfg = config();
    const autoDeliver = cfg.get<boolean>("autoDeliver", false);
    const notices = cfg.get<boolean>("notices", true);
    // Kept: anything else in the file (set from the terminal, or by a newer version).
    const file = airbandFile("config.json");
    writeFileAtomic(file, JSON.stringify({ ...readJson<Record<string, unknown>>(file, {}), contextSize: contextSize(), autoDeliver, notices, writing: writingSettings() }));
  } catch {
    // Defaults apply.
  }
}
