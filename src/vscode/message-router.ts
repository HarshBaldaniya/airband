// Every request from the sidebar and the board, handed to the service that answers it. A request
// that fails shows its reason as a toast in the view that sent it.
import * as vscode from "vscode";
import type { FromWebview } from "../core/protocol";
import { setLevel } from "../sharing/connections";
import { setClaudeAiCredit } from "../install/agent-hooks";
import { BOARD_MESSAGES, boardMessage, type BoardMessage } from "./board-actions";
import type { Controller } from "./controller";
import { libraryMessage } from "./library-page";
import { libraryView } from "./pages";
import { setWriting, writingView } from "./settings";

export async function route(app: Controller, m: FromWebview, from: vscode.Webview): Promise<void> {
  try {
    if (BOARD_MESSAGES.has(m.type)) return await boardMessage(app, m as BoardMessage, from);
    switch (m.type) {
      case "ready":
        app.post({ type: "state", state: app.state }, from);
        app.refreshSoon(0);
        return;
      case "refresh":
        return app.refresh();
      case "open":
        return app.opener.open(m.id);
      case "openInFolder":
        return app.opener.openInFolder(m.id);
      case "openInTerminal":
        return app.opener.openTerminal(m.id);
      case "newChat":
        return app.opener.newChat(m.tool);
      case "openBoard":
        return app.openBoard(m.tab);
      case "setup":
        return app.turnOn();
      case "connect":
        return app.sharing.connect(m.from, m.to, !!m.both, from);
      case "connectMany":
        if (m.handles) app.boardStore().update((b) => (b.handles = { ...(b.handles ?? {}), ...m.handles }));
        return app.sharing.connectMany(m.pairs, from);
      case "disconnect":
        app.sharing.unlink([m.connectionId], from);
        return app.refresh();
      case "disconnectMany":
        app.sharing.unlink(m.ids, from);
        return app.refresh();
      case "direction":
        return app.sharing.direction(m.a, m.b, m.want, from);
      case "pause":
        return app.sharing.pause(m.connectionId, m.paused, from);
      case "linkLevel":
        setLevel(m.ids, m.level);
        return app.refresh();
      case "syncNow":
        return app.sharing.syncNow(m.id);
      case "plans":
        return void app.plansService.refresh(true);
      case "codeMap":
        return void app.mapPage.send(from, m.rebuild, m.root);
      case "codeMapFolder":
        return void app.mapPage.mapAnotherFolder(from);
      case "codeFind":
        return app.mapPage.find(m.q, m.root, from);
      case "codeModule":
        return app.mapPage.module(m.id, m.root, from);
      case "openFile":
        return app.mapPage.openFile(m.path, m.line, m.root);
      case "moduleDoc":
        return void app.mapPage.moduleDoc(m.id, m.action, from, m.root);
      case "library":
      case "librarySuggest":
      case "libraryRun":
      case "libraryCopy":
      case "libraryOpen":
      case "libraryNew":
        return libraryMessage(m, (msg) => app.post(msg, from));
      case "setUpToolkit":
        await app.setup.setUpToolkit();
        return app.post({ type: "library", data: libraryView() }, from);
      case "writing":
        return app.post({ type: "writing", data: writingView() }, from);
      case "writingSet": {
        await setWriting(m.key, m.on);
        return app.post({ type: "writing", data: writingView() }, from);
      }
      case "writingAiCredit":
        setClaudeAiCredit(m.show);
        return app.post({ type: "writing", data: writingView() }, from);
      case "fullscreen":
        return app.fullscreen();
      case "askBranch":
        return app.sharing.askBranch(m.id, from);
      case "branch":
        return app.sharing.branch(m, from);
      case "peek":
        return app.sharing.peek(m.id, from);
    }
  } catch (err) {
    app.toast(err instanceof Error ? err.message : String(err), "warn", from);
  }
}
