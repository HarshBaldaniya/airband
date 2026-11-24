// Setting Airband up in each agent: the hook (live status and sharing), the tools and skills, and
// moving data over from Airband's old names. Each change to an agent's settings is asked first.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Tool } from "../core/agents";
import { OLD_CONVERSATIONS_FOLDER } from "../core/legacy";
import { airbandFile, airbandHome, workspaceAirbandPath } from "../core/paths";
import { findClaude, findNode } from "../core/process";
import { connect, disconnect, hookCommandFor, hookTargets, installedHookPath, isConnected, isToolConnected, staleHookTargets } from "../install/agent-hooks";
import { moveOldHome, moveOldWorkspace } from "../install/migrate";
import { claudePluginInstalled, installFiles } from "../install/setup";
import { installSkills, removeSkills, skillsState } from "../install/skills";
import { agentStates, installToolkit, refreshCodexPrompts, removeToolkit } from "../install/toolkit";
import { pruneRecords } from "../sessions/record/store";
import { readConnections } from "../sharing/connections";
import type { Controller } from "./controller";

export class SetupService {
  constructor(private readonly app: Controller) {}

  private get dist(): string {
    return path.join(this.app.ctx.extensionPath, "dist");
  }

  /** The installed hook and tools stay as new as the extension, and point at a Node that exists. */
  keepHookCurrent(): void {
    try {
      fs.mkdirSync(airbandHome(), { recursive: true });
      fs.copyFileSync(path.join(this.dist, "airband-hook.js"), path.join(airbandHome(), "airband-hook.js"));
      // Airband's tools (notes, session records), once added, stay as new as the extension.
      if (fs.existsSync(path.join(airbandHome(), "airband-mcp.js"))) installFiles(this.dist);
      refreshCodexPrompts();
      // Skills, once added, are rewritten when the extension brings newer ones.
      for (const a of ["claude", "codex"] as const) {
        const s = skillsState(a);
        if (s.installed && s.current < s.installed) installSkills([a]);
      }
      // A hook that names a node no longer there (an nvm version removed) is rewritten with today's.
      const stale = staleHookTargets();
      if (stale.length) {
        const node = findNode();
        for (const t of stale) connect(hookCommandFor(node, t.tool), t.file, t.events, t.timeout, t.timeouts);
      }
    } catch {
      // Not built yet, or no permission: turning on reports it.
    }
  }

  /** Offers auto-sharing once, the first time Airband runs without it. */
  async offerOnce(): Promise<void> {
    const key = "airband.offeredSetup";
    const memory = this.app.ctx.globalState;
    if (!memory || isConnected() || memory.get<boolean>(key)) return;
    await memory.update(key, true);
    const pick = await vscode.window.showInformationMessage(
      "Airband: turn on auto-sharing so connected chats keep each other up to date by themselves?",
      "Turn on",
      "Not now",
    );
    if (pick === "Turn on") await this.turnOn();
  }

  /** Which installed agents have Airband's hook. */
  hookState(): Partial<Record<Tool, boolean>> {
    const out: Partial<Record<Tool, boolean>> = {};
    for (const t of hookTargets()) if (t.present()) out[t.tool] = isToolConnected(t);
    return out;
  }

  hooked(tool: Tool): boolean {
    return !!this.app.state.hooks?.[tool] || !!this.hookState()[tool];
  }

  async turnOn(): Promise<void> {
    const targets = hookTargets().filter((t) => t.present());
    const missing = targets.filter((t) => !isToolConnected(t));
    if (!missing.length) {
      this.app.toast("Every agent here already shares.", "ok", undefined, { title: "Auto-sharing is on", icon: "info" });
      return;
    }
    const names = missing.map((t) => t.tool).join(", ");
    const ok = await vscode.window.showInformationMessage(
      `Turn on auto-sharing for ${names}?`,
      {
        modal: true,
        detail: [
          `Airband adds a small hook to each agent's own settings (${missing.map((t) => t.file.replace(os.homedir(), "~")).join(", ")}; a backup of each is kept).`,
          "With it, connected chats get each other's work by themselves, across agents, and every chat shows whether it is working, waiting for you or done. It never touches your logins.",
          ...missing.filter((t) => t.note).map((t) => t.note!),
          "Turn it off any time with “Airband: Turn off auto-sharing”.",
        ].join("\n\n"),
      },
      "Turn on",
    );
    if (ok !== "Turn on") return;
    this.keepHookCurrent();
    if (!fs.existsSync(installedHookPath())) throw new Error("The hook script is missing. Rebuild Airband (npm run build) and try again.");
    const node = findNode();
    for (const t of missing) connect(hookCommandFor(node, t.tool), t.file, t.events, t.timeout, t.timeouts);
    const codex = missing.find((t) => t.tool === "Codex");
    this.app.toast(codex ? "Last step for Codex: type /hooks in Codex and trust Airband's hook." : `Chats in ${names} pick it up from now.`, "ok", undefined, {
      title: "Auto-sharing on",
      icon: "link",
    });
    this.app.refreshSoon(0);
  }

  turnOff(): void {
    for (const t of hookTargets()) if (t.present()) disconnect(t.file);
    this.app.toast("Connected chats stop updating each other.", "ok", undefined, { title: "Auto-sharing off", icon: "pause" });
    this.app.refreshSoon(0);
  }

  /** Gives the chosen agents Airband's tools (code map, flightlogs, notes) and the Library's commands. */
  async setUpToolkit(): Promise<void> {
    const states = agentStates();
    const picks = await vscode.window.showQuickPick(
      states.map((a) => ({
        label: a.name,
        description: !a.present ? "not found on this computer" : a.tools ? "already set up: refresh it" : "",
        picked: a.present,
        id: a.id,
      })),
      { canPickMany: true, title: "Give these agents Airband's tools and commands", placeHolder: "The code map, flightlogs, notes, and commands such as /plan, /review and /pr" },
    );
    if (!picks?.length) return;
    const what = picks.map((p) => p.label).join(", ");
    const ok = await vscode.window.showInformationMessage(
      `Add Airband to ${what}?`,
      { modal: true, detail: "Each agent's settings are backed up first. Claude Code: added through its own `claude mcp add`, plus its skills in ~/.claude/skills. Codex: a [mcp_servers.airband] table in config.toml, the commands as prompt files, and the skills in ~/.agents/skills. Gemini CLI: an mcpServers entry in settings.json. Remove it any time with \"Airband: Remove the toolkit\"." },
      "Add",
    );
    if (ok !== "Add") return;
    installFiles(this.dist);
    // The Claude Code plugin, when installed, already gives Claude the tools and skills.
    const viaPlugin = claudePluginInstalled();
    const ids = picks.map((p) => p.id).filter((a) => !(a === "claude" && viaPlugin));
    const lines = await installToolkit(ids, { node: findNode(), claudeCli: findClaude() });
    if (viaPlugin && picks.some((p) => p.id === "claude")) lines.unshift("Claude Code: the Airband plugin already gives it the tools.");
    // Skills let the agent reach for the Map and past chats by itself.
    const skillAgents = ids.filter((a): a is "claude" | "codex" => a === "claude" || a === "codex");
    if (skillAgents.length) installSkills(skillAgents);
    void vscode.window.showInformationMessage(`${lines.join(" ")} Start a new chat to use them.`);
  }

  async removeToolkit(): Promise<void> {
    const states = agentStates().filter((a) => a.tools || a.commands);
    if (!states.length) {
      void vscode.window.showInformationMessage("No agent has Airband's tools.");
      return;
    }
    const picks = await vscode.window.showQuickPick(
      states.map((a) => ({ label: a.name, picked: true, id: a.id })),
      { canPickMany: true, title: "Remove Airband's tools and commands from" },
    );
    if (!picks?.length) return;
    const lines = await removeToolkit(picks.map((p) => p.id), { claudeCli: findClaude() });
    removeSkills(picks.map((p) => p.id).filter((a): a is "claude" | "codex" => a === "claude" || a === "codex"));
    void vscode.window.showInformationMessage(lines.join(" "));
  }

  /**
   * Airband was first called Relay, then Crosstalk: its data moves to the new names once (~/.relay,
   * ~/.crosstalk and each project's .relay or .crosstalk folder). Tests, which point Airband at
   * folders of their own, are left alone.
   */
  moveFromOldNames(): void {
    if (!process.env.AIRBAND_HOME) moveOldHome(airbandHome());
    if (!process.env.AIRBAND_WORKSPACE_DIR) for (const f of vscode.workspace.workspaceFolders ?? []) moveOldWorkspace(f.uri.fsPath, workspaceAirbandPath(f.uri.fsPath));
  }

  /**
   * Readable copies of whole conversations are gone (session records replaced them), and a record
   * nothing has used for 30 days goes too, unless its chat is still linked.
   */
  tidyStorage(): void {
    try {
      fs.rmSync(airbandFile(OLD_CONVERSATIONS_FOLDER), { recursive: true, force: true });
      pruneRecords(new Set(readConnections().flatMap((c) => [c.from.id, c.to.id])));
    } catch {
      // Tidying is a nicety.
    }
  }
}
