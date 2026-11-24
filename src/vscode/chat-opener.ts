// Opening chats: in Claude's panel, in a terminal with the agent's own resume command, or in the
// window of the folder a chat belongs to, which another window's Airband is asked to open.
import * as path from "node:path";
import * as vscode from "vscode";
import type { Tool } from "../core/agents";
import { addOpenRequest, dropOpenRequest, openRequestWaiting, registerWindow, takeOpenRequests } from "../core/folders";
import type { ChatSession } from "../core/types";
import type { Controller } from "./controller";
import { openClaude, openInTerminal } from "./open";
import { shortTitle } from "./pages";

/**
 * "Open in its folder": how long the other window's Airband gets to take the request once that window
 * is in front (it takes it at once when current), and the most Airband waits for a window to appear.
 */
const OPEN_ANSWER_MS = 700;
const OPEN_GIVE_UP_MS = 10_000;
/** A Claude that has just started restores its old tabs: the chat is asked for again after this. */
const CLAUDE_SETTLES_MS = 2500;

export class ChatOpener {
  constructor(private readonly app: Controller) {}

  /**
   * A chat of another folder, opened where it belongs: that folder's own VS Code window (VS Code
   * brings it forward when it is open, or opens it), where Airband opens this exact chat in Claude's
   * panel. Only ever on request; a plain click resumes it in a terminal here.
   */
  async openInFolder(id: string): Promise<void> {
    const s = this.app.chats.session(id);
    if (!s.away || !s.cwd) return this.open(id);
    addOpenRequest({ id: s.id, tool: s.tool, cwd: s.cwd, at: Date.now(), title: s.title });
    this.app.toast(`Opening “${shortTitle(s.title)}” in the ${path.basename(s.cwd)} window`, "ok", undefined, { title: path.basename(s.cwd), icon: "info" });
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(s.cwd), { forceNewWindow: true });
    void this.followOpen(s);
  }

  /**
   * Watches the request: done the moment the other window takes it. If that window's Airband doesn't
   * (it runs an older one), Claude's own link goes as soon as the other window is in front, rather
   * than after a fixed wait.
   */
  private async followOpen(s: ChatSession): Promise<void> {
    const start = Date.now();
    let frontSince: number | undefined;
    while (Date.now() - start < OPEN_GIVE_UP_MS) {
      await new Promise((r) => setTimeout(r, 100));
      if (!openRequestWaiting(s.id)) return;
      if (vscode.window.state?.focused === false) frontSince ??= Date.now();
      else frontSince = undefined;
      // Only a Claude chat has a link to fall back on; another agent's waits for that window's Airband.
      if (s.tool === "Claude" && frontSince !== undefined && Date.now() - frontSince >= OPEN_ANSWER_MS) break;
    }
    await this.openFallback(s);
  }

  /**
   * The other window didn't take the request (a window opened before Airband was installed or
   * updated runs the Airband it started with). A Claude chat still opens there: Claude Code's own
   * "open this chat" link goes to the window in front, which is that one while this window is not.
   */
  private async openFallback(s: ChatSession): Promise<void> {
    if (!dropOpenRequest(s.id)) return;
    const folder = path.basename(s.cwd ?? "");
    const otherInFront = vscode.window.state?.focused === false;
    if (s.tool === "Claude" && otherInFront && vscode.env.openExternal) {
      try {
        await vscode.env.openExternal(vscode.Uri.parse(`${vscode.env.uriScheme || "vscode"}://anthropic.claude-code/open?session=${encodeURIComponent(s.id)}`));
        return;
      } catch {
        // Falls through to the note.
      }
    }
    this.app.toast(`Reload the ${folder} window once (Developer: Reload Window), then try again`, "warn", undefined, { title: `The ${folder} window didn't open it`, icon: "info" });
  }

  noteWindow(): void {
    registerWindow((vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath), vscode.env.appName);
  }

  private taking = false;

  /** Chats another window asked this one to open (this window has their folder). */
  async takeOpens(): Promise<void> {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    if (!roots.length || this.taking) return;
    this.taking = true;
    try {
      // Every request opens at once, by id: Claude's in Claude's panel, another agent's resumed in
      // a terminal here. Neither waits for this window to list its chats.
      for (const r of takeOpenRequests(roots, Date.now(), () => true, vscode.env.appName)) {
        if (r.tool === "Claude") await this.openClaudeChatWhenReady(r.id);
        else if (this.app.chats.byId.has(r.id)) await this.open(r.id);
        else this.chatTerminal({ id: r.id, tool: r.tool, cwd: r.cwd, title: r.title ?? r.tool, status: "idle", lastModified: r.at });
      }
    } catch {
      // A request that can't be met is dropped; the chat is still in the list to open by hand.
    } finally {
      this.taking = false;
    }
  }

  /**
   * Opens this exact chat in a window that may have just opened. Claude Code's deep-link command
   * (the one its own "open this chat" link uses) binds a tab to the chat id: it creates it, or
   * brings it forward when that chat is already open, so asking twice never makes a second tab.
   * A window that has just opened also restores the Claude tabs it had before, which can take the
   * front after the first ask; asking again once that has settled leaves the clicked chat in front.
   */
  private async openClaudeChatWhenReady(id: string): Promise<void> {
    const ext = vscode.extensions?.getExtension?.("anthropic.claude-code");
    const wasActive = !!ext?.isActive;
    if (ext && !wasActive) await ext.activate();
    const show = async () => {
      try {
        await vscode.commands.executeCommand("claude-vscode.primaryEditor.open", id);
      } catch {
        await openClaude(id);
      }
    };
    await show();
    // A Claude that has just started restores its old tabs, which can come to the front after the
    // first ask: asking again once that has settled leaves the clicked chat in front.
    if (!wasActive) setTimeout(() => void show(), CLAUDE_SETTLES_MS);
  }

  /** Opens a chat. Context waiting for it goes in with it when the hook can't deliver it. */
  async open(id: string): Promise<void> {
    const s = this.app.chats.session(id);
    // A Claude chat of this folder opens, itself, in Claude Code's panel. One from another folder,
    // like a terminal agent's, is resumed in a terminal in its own folder, where its history lives:
    // this window stays as it is.
    if (s.tool === "Claude" && !s.away) {
      const waiting = !this.app.setup.hooked("Claude") ? this.app.sharing.takeForPaste(id) : undefined;
      return openClaude(id, waiting);
    }
    this.chatTerminal(s);
    const waiting = this.app.setup.hooked(s.tool) ? undefined : this.app.sharing.takeForPaste(id);
    if (waiting) {
      await vscode.env.clipboard.writeText(waiting);
      this.app.toast(`Copied what connected chats did. Paste it into ${s.tool} (⌘V) once it opens.`);
    }
  }

  openTerminal(id: string): void {
    this.chatTerminal(this.app.chats.session(id));
  }

  /** The chat resumed in its own terminal (its folder, its exact session); shown again if it is open. */
  private chatTerminal(s: ChatSession): { terminal: vscode.Terminal; reused: boolean } {
    const where = s.away && s.cwd ? ` · ${path.basename(s.cwd)}` : "";
    return openInTerminal(`${s.tool} · ${shortTitle(s.title)}${where}`, this.app.chats.adapter(s.tool).resumeCommand!(s), s.cwd ?? this.app.root, s.id);
  }

  async newChat(tool: Tool): Promise<void> {
    if (tool === "Claude") return openClaude(undefined);
    openInTerminal(tool, this.app.chats.adapter(tool).newCommand!(), this.app.root);
  }
}
