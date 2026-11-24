// A chat's details under its row: folder, model and context, its channels, the updates on their
// way, and the ways to open it.
import type { ConnectionView } from "../../src/vscode/protocol";
import { contextPct, tokens, whereItOpens } from "../lib/format";
import { folderName } from "../lib/folders";
import { send } from "../lib/vscode";
import { ContextBar } from "../components/ContextBar";
import { ArrowLeft, ArrowLeftRight, ArrowRight, FolderOpen, GitBranch, I, LayoutGrid, Link2, Pause, Play, SquareTerminal, ToolMark, Unlink } from "../components/Icons";
import { Incoming } from "../components/Incoming";
import { ModelName } from "../components/ModelName";
import type { RowProps } from "./ChatRow";
import type { MergedLink } from "./grouping";

export function ChatDetails({ s, links, waiting, waitingFrom, onLink, onBranch }: RowProps) {
  const pct = contextPct(s.context);
  return (
    <div className="details">
      {(s.model || s.context || s.away) && (
        <div className="facts">
          {s.away && (
            <div className="fact">
              <span className="muted">Folder</span>
              <span className="ellipsis" data-tip={s.cwd}>
                {folderName(s.cwd)}
              </span>
            </div>
          )}
          {s.model && (
            <div className="fact">
              <span className="muted">Model</span>
              <ModelName s={s} />
            </div>
          )}
          {s.context && pct !== undefined && (
            <div className="fact">
              <span className="muted">Context</span>
              <span className="ctx" data-tip={`${s.context.used.toLocaleString()} of ${s.context.window.toLocaleString()} tokens`}>
                <ContextBar pct={pct} />
                {pct}%<span className="ofwin"> of {tokens(s.context.window)}</span>
              </span>
            </div>
          )}
        </div>
      )}
      {links.length ? (
        <div className="detailblock">
          <div className="detailhead">Channels</div>
          <div className="linklist">
            {links.map((l) => (
              <LinkRow key={l.other.id} l={l} />
            ))}
          </div>
        </div>
      ) : (
        <p className="explain">Open a channel to another chat and each keeps up with what the other did, after every reply.</p>
      )}
      {!!waiting && <Incoming id={s.id} waiting={waiting} from={waitingFrom} />}
      <div className="detailactions">
        <button className="btn small" onClick={onLink} data-tip="Pick chats to share work with">
          <Link2 {...I} /> <span className="blabel">Connect…</span>
        </button>
        <button className="btn small" onClick={onBranch} data-tip="Start a new chat for a separate task, with this chat's context">
          <GitBranch {...I} /> <span className="blabel">New task</span>
        </button>
        <span className="grow" />
        {/* This folder's chat opens in Claude's panel, so the extra way is a terminal. Another
            folder's chat already opens in a terminal, so the extra way is its own folder's window. */}
        {s.away ? (
          <button
            className="icon openfolder"
            onClick={() => send({ type: "openInFolder", id: s.id })}
            data-tip={`Open in ${folderName(s.cwd)}: its own window, ${whereItOpens(s.tool)}`}
            aria-label={`Open this chat in ${folderName(s.cwd)}`}
          >
            <FolderOpen {...I} />
          </button>
        ) : (
          <button className="icon" onClick={() => send({ type: "openInTerminal", id: s.id })} aria-label="Open in terminal" data-tip="Open in terminal">
            <SquareTerminal {...I} />
          </button>
        )}
        <button className="icon" onClick={() => send({ type: "boardAdd", id: s.id, open: true })} aria-label="Show on Tower" data-tip="Show on Tower">
          <LayoutGrid {...I} />
        </button>
      </div>
    </div>
  );
}

function LinkRow({ l }: { l: MergedLink }) {
  const both = !!(l.shares && l.learns);
  const conns = [l.shares, l.learns].filter((c): c is ConnectionView => !!c);
  const paused = conns.every((c) => c.paused);
  const how = both ? "both ways" : l.shares ? "shares with it" : "learns from it";
  const DirIcon = both ? ArrowLeftRight : l.shares ? ArrowRight : ArrowLeft;
  return (
    <div className={`linkrow ${paused ? "paused" : ""}`}>
      <ToolMark tool={l.other.tool} size={18} />
      <span className="linkname">
        <span className="ellipsis">{l.other.title}</span>
        <span className={`linkhow ${both ? "both" : l.shares ? "out" : "in"}`}>
          <DirIcon {...I} size={11} /> {paused ? "paused" : how}
        </span>
      </span>
      <span className="linkbtns">
        <button
          className="icon sm"
          onClick={() => conns.forEach((c) => send({ type: "pause", connectionId: c.id, paused: !paused }))}
          aria-label={paused ? `Resume sharing with “${l.other.title}”` : `Pause sharing with “${l.other.title}”`}
          data-tip={paused ? "Resume sharing" : "Pause sharing"}
        >
          {paused ? <Play {...I} size={13} /> : <Pause {...I} size={13} />}
        </button>
        <button className="icon sm" onClick={() => send({ type: "disconnectMany", ids: conns.map((c) => c.id) })} aria-label={`Close the channel with “${l.other.title}”`} data-tip="Close channel">
          <Unlink {...I} size={13} />
        </button>
      </span>
    </div>
  );
}
