import * as vscode from "vscode";
import { Controller } from "./vscode/controller";
import { CodeMapService } from "./vscode/codemap-service";
import { BackupService } from "./vscode/backup-service";
import { RunsService } from "./vscode/runs-service";
import { RUNS_OFFERED } from "./core/offered";

export function activate(ctx: vscode.ExtensionContext): void {
  const controller = new Controller(ctx);
  ctx.subscriptions.push(controller);
  const codeMap = new CodeMapService();
  ctx.subscriptions.push(codeMap);
  controller.useCodeMaps(codeMap);
  // Runs are not offered yet: nothing of them starts, watches or shows.
  const runs = RUNS_OFFERED ? new RunsService(() => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath) : undefined;
  if (runs) {
    ctx.subscriptions.push(runs);
    controller.useRuns(runs);
    ctx.subscriptions.push(
      vscode.commands.registerCommand("airband.openRuns", () => controller.openBoard("runs")),
      vscode.commands.registerCommand("airband.stopAll", () => runs.stopAll()),
    );
  }
  const backup = new BackupService();
  ctx.subscriptions.push(backup);
  const offer = setTimeout(() => void controller.offerSetupOnce().catch(() => undefined), 3000);
  ctx.subscriptions.push({ dispose: () => clearTimeout(offer) });

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "airband.chats",
      {
        resolveWebviewView(view) {
          const detach = controller.attach(view.webview, "sidebar");
          view.onDidDispose(() => detach.dispose());
          view.onDidChangeVisibility(() => view.visible && controller.refreshSoon(0));
        },
      },
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand("airband.refresh", () => controller.refresh()),
    vscode.commands.registerCommand("airband.openBoard", () => controller.openBoard("board")),
    vscode.commands.registerCommand("airband.openUsage", () => controller.openBoard("usage")),
    vscode.commands.registerCommand("airband.openCode", () => controller.openBoard("code")),
    vscode.commands.registerCommand("airband.openLibrary", () => controller.openBoard("library")),
    vscode.commands.registerCommand("airband.openWriting", () => controller.openBoard("writing")),
    vscode.commands.registerCommand("airband.newChat", () => controller.newChatCommand()),
    vscode.commands.registerCommand("airband.connect", () => controller.turnOn()),
    vscode.commands.registerCommand("airband.disconnect", () => controller.turnOff()),
    vscode.commands.registerCommand("airband.addNotesTools", () => controller.addNotesTools()),
    vscode.commands.registerCommand("airband.setUpToolkit", () => controller.setUpToolkit()),
    vscode.commands.registerCommand("airband.removeToolkit", () => controller.removeToolkit()),
    vscode.commands.registerCommand("airband.rebuildCodeMap", () => codeMap.rebuild()),
    vscode.commands.registerCommand("airband.moduleDocs", () => codeMap.moduleDocs()),
    vscode.commands.registerCommand("airband.backUp", () => backup.backUpNow()),
    vscode.commands.registerCommand("airband.restore", () => backup.restoreNow()),
  );
}

export function deactivate(): void {}
