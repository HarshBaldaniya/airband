import { useState } from "react";
import type { ChatSession } from "../../../src/core/types";
import { useViewState } from "../../app/ViewStateContext";
import { agoText } from "../../lib/format";
import { DRAG_TYPE, folderHints, folderName, folderOf } from "../../lib/folders";
import { send } from "../../lib/vscode";
import { ChevronRight, Folder, FolderOpen, I, Plus, Search, ToolMark, X } from "../../components/Icons";

/**
 * Chats not on the board, ready to add: grouped by folder (this window's first, then the most
 * recently active), each folder with Add all; a search over titles and folder names.
 */
export function Tray({ onBoard, close }: { onBoard: Set<string>; close: () => void }) {
  const state = useViewState();
  const [q, setQ] = useState("");
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const needle = q.trim().toLowerCase();
  const list = state.sessions.filter(
    (s) => !onBoard.has(s.id) && (!needle || s.title.toLowerCase().includes(needle) || folderName(folderOf(s, state.root)).toLowerCase().includes(needle)),
  );
  const groups = new Map<string, ChatSession[]>();
  for (const s of list) groups.set(folderOf(s, state.root), [...(groups.get(folderOf(s, state.root)) ?? []), s]);
  const order = [...groups.keys()].sort((a, b) =>
    a === state.root ? -1 : b === state.root ? 1 : Math.max(...groups.get(b)!.map((x) => x.lastModified)) - Math.max(...groups.get(a)!.map((x) => x.lastModified)),
  );
  // Two folders with the same name are told apart by their parent.
  const hints = folderHints(order);
  // This folder starts open, the rest closed; a search opens every folder it finds something in.
  const isOpen = (f: string) => !!needle || (openFolders[f] ?? f === state.root);
  return (
    <aside className="tray" aria-label="Chats not on the Tower">
      <div className="trayhead">
        <span className="traytitle">Add to Tower</span>
        <button className="icon sm" onClick={close} aria-label="Hide the chat list" data-tip="Hide">
          <X {...I} />
        </button>
      </div>
      <div className="searchrow traysearch">
        <Search {...I} className="muted" />
        <input className="search" placeholder="Find a chat or folder" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a chat to add" />
        {q && (
          <button className="icon sm" aria-label="Clear" onClick={() => setQ("")}>
            <X {...I} size={12} />
          </button>
        )}
      </div>
      <div className="traylist">
        {order.map((f) => {
          const items = groups.get(f)!;
          const open = isOpen(f);
          const here = f === state.root;
          return (
            <section key={f} className="traygroup">
              <div className="traygrouphead">
                <button className="traygroupbtn" onClick={() => setOpenFolders((o) => ({ ...o, [f]: !open }))} aria-expanded={open}>
                  <ChevronRight {...I} size={13} className={`chev ${open ? "open" : ""}`} />
                  {here ? <FolderOpen {...I} size={13} className="tfolder here" /> : <Folder {...I} size={13} className="tfolder" />}
                  <span className="ellipsis">{folderName(f) || "This folder"}</span>
                  {hints.get(f) && <span className="fhint ellipsis">{hints.get(f)}</span>}
                  <span className="traycount">{items.length}</span>
                </button>
                <button className="trayaddall" onClick={() => items.forEach((s) => send({ type: "boardAdd", id: s.id }))} aria-label={`Add every chat of ${folderName(f)} to the board`}>
                  <Plus {...I} size={12} /> All
                </button>
              </div>
              {open &&
                items.map((s) => (
                  <div
                    key={s.id}
                    className="trayitem"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, s.id);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <span className={`traytile tool-${s.tool.toLowerCase()}`}>
                      <ToolMark tool={s.tool} size={13} />
                    </span>
                    <span className="traytext">
                      <span className="traytitleline">{s.title}</span>
                      <span className="traymeta">{agoText(s.lastModified)}</span>
                    </span>
                    <button className="icon sm addbtn" onClick={() => send({ type: "boardAdd", id: s.id })} aria-label={`Add “${s.title}” to the board`}>
                      <Plus {...I} />
                    </button>
                  </div>
                ))}
            </section>
          );
        })}
        {!list.length && <p className="muted small pad">{q ? "No chats match." : "Every chat is on the board."}</p>}
      </div>
    </aside>
  );
}
