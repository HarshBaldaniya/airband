// A chat on the Tower: its agent, title and status, its model and context, who it shares with, the
// updates on their way to it, and a dot on each side to draw a line from.
import { memo, useContext, useEffect, useRef, useState } from "react";
import { Handle, type NodeProps } from "@xyflow/react";
import { agoText, contextPct, level, whereItOpens } from "../../lib/format";
import { folderName } from "../../lib/folders";
import { send } from "../../lib/vscode";
import { ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, ExternalLink, Eye, Folder, FolderOpen, GitBranch, I, MessageSquareDot, RefreshCw, StatusChip, ToolMark, X } from "../../components/Icons";
import { ModelName } from "../../components/ModelName";
import { SIDES } from "./edges";
import { LinkMode, type CardNode } from "./types";

/** How long the green flash lasts when a chat finishes a reply. */
const FLASH_MS = 1600;

export const ChatCard = memo(function ChatCard({ data, selected }: NodeProps<CardNode>) {
  const { s, links, waiting } = data;
  const linkMode = useContext(LinkMode);
  const role = linkMode.from === s.id ? "linksource" : linkMode.from ? "linktarget" : "";
  // A short green flash when the chat finishes a reply.
  const prev = useRef(s.status);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = s.status;
    if (was !== s.status && s.status === "done" && was === "working") {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), FLASH_MS);
      return () => clearTimeout(t);
    }
  }, [s.status]);
  const pct = contextPct(s.context);
  const shown = links.slice(0, 2);
  return (
    <div className={`bcard ${s.status} tool-${s.tool.toLowerCase()} ${selected ? "selected" : ""} ${flash ? "justdone" : ""} ${role}`}>
      <div className="bcardhead">
        <span className="bcardlogo">
          <ToolMark tool={s.tool} size={20} />
        </span>
        <div className="bcardheading">
          <button className="bcardtitle nodrag nopan" onClick={() => send({ type: "open", id: s.id })} data-tip={s.title.length > 60 ? s.title : `Open in ${s.tool}`}>
            {s.title}
          </button>
          <div className="bcardsub">
            <StatusChip key={s.status} status={s.status} />
            <span className="muted small">{agoText(s.lastModified)}</span>
          </div>
        </div>
        {/* Corner actions float over the card on hover, so the title keeps the card's whole width. */}
        <span className="bcardcorner nodrag nopan">
          {s.away && (
            <button className="icon sm" onClick={() => send({ type: "openInFolder", id: s.id })} aria-label={`Open “${s.title}” in ${folderName(s.cwd)}`} data-tip={`Open in ${folderName(s.cwd)}, ${whereItOpens(s.tool)}`}>
              <FolderOpen {...I} />
            </button>
          )}
          <button className="icon sm" onClick={() => send({ type: "boardRemove", id: s.id })} aria-label={`Take “${s.title}” off the board`} data-tip="Take off the Tower">
            <X {...I} />
          </button>
        </span>
      </div>
      {s.status === "waiting" && s.lastLine && <div className="bcardattn">{s.lastLine}</div>}
      {(s.model || s.context || links.length > 0 || (s.away && !data.inPanel)) && (
        <dl className="bcardfacts">
          {s.away && !data.inPanel && (
            <>
              <dt>Folder</dt>
              <dd className="bfolder">
                <button className="bfolderbtn nodrag nopan" onClick={() => send({ type: "openInFolder", id: s.id })} data-tip={`Open ${folderName(s.cwd)} in its own window, ${whereItOpens(s.tool)}`}>
                  <Folder {...I} size={12} />
                  <span className="ellipsis">{folderName(s.cwd)}</span>
                  <ArrowUpRight {...I} size={12} />
                </button>
              </dd>
            </>
          )}
          {s.model && (
            <>
              <dt>Model</dt>
              <dd>
                <ModelName s={s} />
              </dd>
            </>
          )}
          {s.context && pct !== undefined && (
            <>
              <dt>Context</dt>
              <dd className="ctx" data-tip={`${s.context.used.toLocaleString()} of ${s.context.window.toLocaleString()} tokens`}>
                <span className={`ctxbar ${level(pct)}`}>
                  <span style={{ width: `${Math.max(2, pct)}%` }} />
                </span>
                {pct}%
              </dd>
            </>
          )}
          {links.length > 0 && (
            <>
              <dt>Connected</dt>
              <dd className="bcardlinks">
                {shown.map((l) => (
                  <span key={l.id} className={`bcardlink ${l.dir}`} data-tip={l.dir === "both" ? "Shares both ways" : l.dir === "out" ? "Shares with it" : "Learns from it"}>
                    {l.dir === "both" ? <ArrowLeftRight {...I} size={11} /> : l.dir === "out" ? <ArrowRight {...I} size={11} /> : <ArrowLeft {...I} size={11} />}
                    <span className="ellipsis">{l.title}</span>
                  </span>
                ))}
                {links.length > shown.length && <span className="muted small">+{links.length - shown.length} more</span>}
              </dd>
            </>
          )}
        </dl>
      )}
      {!!waiting && (
        <div key={waiting} className="incoming nodrag nopan">
          <div className="inhead">
            <span className="inicon" aria-hidden="true">
              <MessageSquareDot {...I} size={15} />
            </span>
            <span className="intext">
              <b>
                {waiting} update{waiting === 1 ? "" : "s"} on the way
              </b>
              <span className="insub">from {(data.from ?? []).join(", ") || "linked chats"}</span>
            </span>
          </div>
          <div className="inactions">
            <button className="btn tiny ghost" onClick={() => send({ type: "peek", id: s.id })}>
              <Eye {...I} size={12} /> View
            </button>
            <button className="btn tiny primary" onClick={() => send({ type: "syncNow", id: s.id })} data-tip="They arrive by themselves when the chat replies or gets its next message. Sync sends them now.">
              <RefreshCw {...I} size={12} /> Sync
            </button>
          </div>
        </div>
      )}
      <div className="bcardactions nodrag nopan">
        <button className="btn small" onClick={() => send({ type: "open", id: s.id })}>
          <ExternalLink {...I} size={13} /> Open
        </button>
        <button className="btn small ghost" onClick={() => send({ type: "askBranch", id: s.id })} data-tip="Start a new chat for a separate task, with this chat's context">
          <GitBranch {...I} size={13} /> New task
        </button>
      </div>
      {SIDES.map(([side, pos]) => (
        <Handle key={side} id={side} type="source" position={pos} className={`port ${side}`} data-tip="Drag (or click) to connect to another chat" />
      ))}
    </div>
  );
});

