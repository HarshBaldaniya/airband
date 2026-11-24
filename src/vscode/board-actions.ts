// What the Tower's cards do to the board kept with the workspace: added, moved, taken off, cleared
// and put back, laid out, and where the view was left.
import type * as vscode from "vscode";
import type { FromWebview } from "./protocol";
import type { Controller } from "./controller";

export type BoardMessage = Extract<FromWebview, { type: "boardAdd" | "boardRemove" | "move" | "boardClear" | "boardRestore" | "viewport" | "boardArrange" | "scope" | "arrange" }>;

export const BOARD_MESSAGES: ReadonlySet<string> = new Set<BoardMessage["type"]>(["boardAdd", "boardRemove", "move", "boardClear", "boardRestore", "viewport", "boardArrange", "scope", "arrange"]);

export async function boardMessage(app: Controller, m: BoardMessage, from: vscode.Webview): Promise<void> {
  const store = app.boardStore();
  switch (m.type) {
    case "boardAdd":
      store.update((b) => {
        if (!b.members.includes(m.id)) b.members.push(m.id);
        if (m.x !== undefined && m.y !== undefined) b.positions[m.id] = { x: Math.round(m.x), y: Math.round(m.y) };
      });
      // From the sidebar, show the board with the chat on it.
      if (m.open) app.openBoard("board");
      return app.refresh();
    case "boardRemove":
      store.update((b) => (b.members = b.members.filter((id) => id !== m.id)));
      return app.refresh();
    case "move":
      store.update((b) => (b.positions[m.id] = { x: Math.round(m.x), y: Math.round(m.y) }));
      app.state.board.positions[m.id] = { x: m.x, y: m.y };
      return;
    case "boardClear": {
      const before = store.read();
      if (!before.members.length) return;
      store.update((b) => {
        b.members = [];
        b.positions = {};
        b.seeded = true;
      });
      app.toast(`${before.members.length} card${before.members.length === 1 ? "" : "s"} taken off. Add chats back from the list, a folder at a time or one by one.`, "ok", from, {
        title: "Tower cleared",
        icon: "info",
        undo: { type: "boardRestore", members: before.members, positions: before.positions },
      });
      return app.refresh();
    }
    case "boardRestore":
      store.update((b) => {
        b.members = [...new Set([...m.members, ...b.members])];
        b.positions = { ...m.positions, ...b.positions };
      });
      return app.refresh();
    case "viewport":
      // Kept quietly: nothing else on screen depends on it.
      store.update((b) => (b.viewport = m.viewport));
      app.state.board.viewport = m.viewport;
      return;
    case "boardArrange":
      store.update((b) => (b.arrange = m.arrange));
      return app.refresh();
    case "scope":
      // Every folder in the sidebar: the board groups by folder too; back to this folder: by links.
      store.update((b) => (b.arrange = m.scope === "all" ? "folder" : "links"));
      return app.refresh();
    case "arrange":
      // Every card placed stays on the board (a drag in "By time" keeps all the chats it showed).
      store.update((b) => {
        Object.assign(b.positions, m.positions);
        for (const id of Object.keys(m.positions)) if (!b.members.includes(id)) b.members.push(id);
      });
      return app.refresh();
  }
}
