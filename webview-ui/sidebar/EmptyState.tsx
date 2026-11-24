import type { Tool } from "../../src/core/agents";
import { send } from "../lib/vscode";
import { FolderTree, FolderX, I, MessageSquareDot, SearchX, ToolMark, X } from "../components/Icons";

/** What the list shows when it has nothing: says why, and offers the one step that helps. */
export function EmptyState(p: {
  kind: "picked" | "search" | "none";
  query: string;
  tool: Tool | "All";
  folder: string;
  tools: Tool[];
  canSeeAll: boolean;
  showAll: () => void;
  clearSearch: () => void;
  seeAll: () => void;
}) {
  if (p.kind === "picked")
    return (
      <div className="emptystate">
        <span className="emptyicon">
          <FolderX {...I} size={20} />
        </span>
        <p className="emptytitle">No folders picked</p>
        <p className="emptytext">Tick the folders to show, or show them all.</p>
        <div className="emptyactions">
          <button className="btn primary" onClick={p.showAll}>
            <FolderTree {...I} size={13} /> Show all folders
          </button>
        </div>
      </div>
    );
  if (p.kind === "search")
    return (
      <div className="emptystate">
        <span className="emptyicon">
          <SearchX {...I} size={20} />
        </span>
        <p className="emptytitle">{p.query ? `Nothing matches “${p.query}”` : `No ${p.tool} chats here`}</p>
        <p className="emptytext">{p.query ? "Try another word, or a folder's name." : "Other agents' chats are under All."}</p>
        <div className="emptyactions">
          <button className="btn" onClick={p.clearSearch}>
            <X {...I} size={13} /> {p.query ? "Clear search" : "Show every agent"}
          </button>
        </div>
      </div>
    );
  return (
    <div className="emptystate">
      <span className="emptyicon">
        <MessageSquareDot {...I} size={20} />
      </span>
      <p className="emptytitle">No chats here yet</p>
      <p className="emptytext">Start one in {p.folder || "this folder"}. Airband picks it up by itself.</p>
      <div className="emptyactions">
        {p.tools.map((t, i) => (
          <button key={t} className={`btn ${i === 0 ? "primary" : ""}`} onClick={() => send({ type: "newChat", tool: t })}>
            <ToolMark tool={t} size={13} /> New {t} chat
          </button>
        ))}
      </div>
      {p.canSeeAll && (
        <button className="linkish emptymore" onClick={p.seeAll}>
          <FolderTree {...I} size={12} /> See chats in your other folders
        </button>
      )}
    </div>
  );
}
