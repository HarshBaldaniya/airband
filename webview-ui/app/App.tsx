// The page the extension shows: the sidebar, or the board with its tabs. It keeps what the
// extension last said, and the one dialog open at a time.
import { useCallback, useEffect, useState } from "react";
import type { BoardTab, ViewState } from "../../src/core/protocol";
import { BoardPage } from "../board/BoardPage";
import { Modals, type Modal } from "../components/Modals";
import { TooltipLayer } from "../components/Tooltip";
import { onMessage, send } from "../lib/vscode";
import { Sidebar } from "../sidebar/Sidebar";
import { ModalContext } from "./ModalContext";
import { Toasts } from "./Toasts";
import { EMPTY_STATE, ViewStateContext } from "./ViewStateContext";

/** A request that failed on the extension's side leaves "loading" up: it goes after this long. */
const LOADING_GIVES_UP_MS = 15_000;

export function App({ view }: { view: "board" | "sidebar" }) {
  const [state, setState] = useState<ViewState>(EMPTY_STATE);
  const [modal, setModal] = useState<Modal | null>(null);
  const [tab, setTab] = useState<BoardTab>("board");
  const close = useCallback(() => setModal(null), []);

  useEffect(() => {
    const off = onMessage((msg) => {
      if (msg.type === "state") setState(msg.state);
      if (msg.type === "tab") setTab(msg.tab);
      if (msg.type === "peek") setModal({ kind: "peek", title: msg.title, text: msg.text });
      if (msg.type === "branchInfo") setModal({ kind: "branch", id: msg.id, title: msg.title, tool: msg.tool, asks: msg.asks, contextChars: msg.contextChars });
    });
    send({ type: "ready" });
    return off;
  }, []);

  useEffect(() => {
    if (modal?.kind !== "loading") return;
    const t = setTimeout(() => setModal(null), LOADING_GIVES_UP_MS);
    return () => clearTimeout(t);
  }, [modal]);

  return (
    <ViewStateContext.Provider value={state}>
      <ModalContext.Provider value={setModal}>
        {view === "board" ? <BoardPage tab={tab} setTab={setTab} /> : <Sidebar />}
        <Modals modal={modal} close={close} />
        <TooltipLayer />
        <Toasts />
      </ModalContext.Provider>
    </ViewStateContext.Provider>
  );
}
