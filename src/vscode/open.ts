// Opening chats. Claude chats open in Claude's own extension, wherever the
// person keeps Claude (its sidebar, or an editor tab), never in a new locked
// tab group. Tools without an editor extension open in a terminal tab with
// their own resume command.
import * as vscode from "vscode";

const OPEN = "claude-vscode.editor.open";

export async function claudeExtensionInstalled(): Promise<boolean> {
  return (await vscode.commands.getCommands(true)).includes(OPEN);
}

/**
 * Claude's command is `editor.open(sessionId?, prompt?, viewColumn?, group?, fullEditor?, options?)`.
 * `programmatic: "honor-preferred-location"` makes it open where the person keeps
 * Claude rather than in a new locked editor group. It is not a documented API, so
 * any prompt is also copied: if the box stays empty, the person pastes it.
 */
export async function openClaude(sessionId: string | undefined, prompt?: string): Promise<void> {
  if (prompt) await vscode.env.clipboard.writeText(prompt);
  if (!(await claudeExtensionInstalled())) {
    const pick = await vscode.window.showWarningMessage(
      prompt ? "Claude Code's extension isn't installed, so Airband copied the text. Paste it into your chat." : "Claude Code's extension isn't installed.",
      "Get Claude Code",
    );
    if (pick) await vscode.commands.executeCommand("workbench.extensions.search", "anthropic.claude-code");
    return;
  }
  try {
    await vscode.commands.executeCommand(OPEN, sessionId, prompt, undefined, undefined, undefined, { programmatic: "honor-preferred-location" });
  } catch {
    // Older versions take fewer arguments.
    await vscode.commands.executeCommand(OPEN, sessionId, prompt);
  }
}

const chatTerminals = new Map<string, vscode.Terminal>();

/**
 * A terminal tab in the editor area, named after the chat, running the tool's own command in
 * the chat's own folder. Opening the same chat again shows its terminal rather than starting a
 * second copy of it (two copies of one chat would split it in two). `reused` says which.
 */
export function openInTerminal(name: string, command: string, cwd?: string, chatId?: string): { terminal: vscode.Terminal; reused: boolean } {
  const open = chatId ? chatTerminals.get(chatId) : undefined;
  if (open && open.exitStatus === undefined && (vscode.window.terminals ?? []).includes(open)) {
    open.show();
    return { terminal: open, reused: true };
  }
  const terminal = vscode.window.createTerminal({ name, cwd, location: { viewColumn: vscode.ViewColumn.Active } });
  terminal.show();
  terminal.sendText(command);
  if (chatId) chatTerminals.set(chatId, terminal);
  return { terminal, reused: false };
}

