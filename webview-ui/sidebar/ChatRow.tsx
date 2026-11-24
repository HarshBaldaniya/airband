// One chat in the sidebar: its agent, title and one quiet line on what is going on, with actions on
// hover and its details below when opened.
import type { HTMLAttributes } from "react";
import type { ChatSession } from "../../src/core/types";
import { agoText, contextPct, level, modelName, tokens } from "../lib/format";
import { folderName } from "../lib/folders";
import { send } from "../lib/vscode";
import { Check, ChevronRight, Folder, GitBranch, I, Link2, Plus, ToolMark } from "../components/Icons";
import { ChatDetails } from "./ChatDetails";
import type { MergedLink } from "./grouping";

export interface RowProps {
  /** Shown inside a folder's group: drawn under it, on its guide line. */
  nested?: boolean;
  /** The chat is from another folder, and its group doesn't already say which. */
  showFolder: boolean;
  /** More than one AI tool has chats here, so each row shows which. */
  manyTools: boolean;
  s: ChatSession;
  links: MergedLink[];
  waiting?: number;
  waitingFrom?: string[];
  expanded: boolean;
  linking: string | null;
  linked: boolean;
  dropTarget: boolean;
  isDragging: boolean;
  onToggleExpand: () => void;
  onLink: () => void;
  onPickLink: () => void;
  onBranch: () => void;
  drag: HTMLAttributes<HTMLDivElement> & { draggable: boolean };
}

export function ChatRow(p: RowProps) {
  const { s } = p;
  const isSource = p.linking === s.id;
  const picking = !!p.linking && !isSource;
  const cls = ["row", s.status, `tool-${s.tool.toLowerCase()}`, p.expanded && "open", p.dropTarget && "drop", p.isDragging && "dragging", isSource && "source", picking && "picking", p.linked && "linked"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={`rowwrap ${p.nested ? "nested" : ""}`} data-flip={s.id}>
      <div className={cls} {...p.drag}>
        <button
          className="rowmain"
          onClick={() => (picking ? p.onPickLink() : send({ type: "open", id: s.id }))}
          data-tip={picking ? (p.linked ? "Click to disconnect" : "Click to connect") : s.title.length > 30 ? s.title : undefined}
        >
          <ChatAvatar s={s} />
          <span className="rowtext">
            <span className="rowtop">
              <span className="rowtitle">{s.title}</span>
              {!!p.waiting && (
                <span className="unread" data-tip={`${p.waiting} update${p.waiting === 1 ? "" : "s"} from linked chats, arriving with its next message`}>
                  {p.waiting}
                </span>
              )}
            </span>
            <RowLine {...p} />
          </span>
        </button>
        {picking ? (
          <button
            className={`pickcheck ${p.linked ? "on" : ""}`}
            onClick={p.onPickLink}
            aria-pressed={p.linked}
            aria-label={p.linked ? `Disconnect “${s.title}”` : `Connect with “${s.title}”`}
          >
            {p.linked ? <Check {...I} size={12} strokeWidth={3} /> : <Plus {...I} size={12} />}
          </button>
        ) : isSource ? (
          <span className="sourcetag">Connecting</span>
        ) : (
          <span className="rowactions">
            {/* Open, the details below have Link to… and New task: the row keeps only its arrow. */}
            {!p.expanded && (
              <>
                <button className={`icon ${isSource ? "on" : ""}`} onClick={p.onLink} aria-label={`Connect “${s.title}” to other chats`} data-tip="Connect to other chats">
                  <Link2 {...I} />
                </button>
                <button className="icon" onClick={p.onBranch} aria-label={`New task from “${s.title}”`} data-tip="New task from this chat">
                  <GitBranch {...I} />
                </button>
              </>
            )}
            <button className="icon" onClick={p.onToggleExpand} aria-label="More" aria-expanded={p.expanded} data-tip="More">
              <ChevronRight {...I} className={`chev ${p.expanded ? "open" : ""}`} />
            </button>
          </span>
        )}
      </div>
      {p.expanded && !p.linking && <ChatDetails {...p} />}
    </div>
  );
}

/** One line in words: what it is doing, its model and how full it is, and who it is linked with. */
function RowLine({ s, links, showFolder }: RowProps) {
  const pct = contextPct(s.context);
  if (s.status === "waiting") {
    return (
      <span className="rowmeta">
        <span className="state waiting">{s.lastLine || "Needs you"}</span>
        {showFolder && <FolderTag s={s} />}
      </span>
    );
  }
  const linkTip = `Linked with ${links.map((l) => l.other.title).join(", ")}`;
  return (
    <span className="rowmeta">
      {s.status === "working" ? <span className="state working">Working…</span> : <span>{agoText(s.lastModified)}</span>}
      {s.model && (
        <span className="mtext">
          {modelName(s.model)}
        </span>
      )}
      {pct !== undefined && s.context && (
        <span className={`ctxtag ${level(pct)}`} data-tip={`Context ${pct}% full: ${Math.round(s.context.used / 1000)}K of ${tokens(s.context.window)} tokens`}>
          <ContextRing pct={pct} />
          {pct}%<span className="ctxword"> context</span>
        </span>
      )}
      {showFolder && <FolderTag s={s} />}
      {links.length > 0 && (
        <span className="linkedtag" data-tip={linkTip}>
          <Link2 {...I} size={11} />
          <span className="ltext">{links.length === 1 ? links[0].other.title : `${links.length} chats`}</span>
          <span className="lcount">{links.length}</span>
        </span>
      )}
    </span>
  );
}

/** Which folder a chat from elsewhere works in (its full path on hover). */
function FolderTag({ s }: { s: ChatSession }) {
  return (
    <span className="foldertag" data-tip={s.cwd}>
      <Folder {...I} size={11} />
      <span className="ellipsis">{folderName(s.cwd)}</span>
    </span>
  );
}

/** The agent's own logo in a tile tinted with its colour; the tile's ring shows the status. */
function ChatAvatar({ s }: { s: ChatSession }) {
  return (
    <span className={`avatar tool-${s.tool.toLowerCase()} ${s.status}`} aria-hidden="true">
      <ToolMark tool={s.tool} size={16} />
    </span>
  );
}

/** A small ring that fills as the context window does. */
function ContextRing({ pct }: { pct: number }) {
  const r = 5;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`ring ${level(pct)}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r={r} className="ringbg" />
      <circle cx="6" cy="6" r={r} className="ringfg" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 6 6)" />
    </svg>
  );
}
