// The sidebar: every AI chat in this folder, grouped by what needs attention.
// "All folders" shows the chats of every project instead, grouped by folder; a
// chat from another folder that is linked to one here always shows, labelled.
// Kept simple on purpose: the tool's logo, the title, one quiet line saying
// what is going on, and actions on hover. Tokens live on the Fuel page.
//
// Linking: press a row's link icon and click the chats it should share with
// (or drag one row onto another). No dialogs: the link works at once.
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import type { ChatSession } from "../../src/core/types";
import type { Tool } from "../../src/core/agents";
import { agoText } from "../lib/format";
import { DRAG_TYPE, folderName, folderOf } from "../lib/folders";
import { remember, remembered, send } from "../lib/vscode";
import {
  ChevronRight,
  I,
  Folder,
  FolderOpen,
  FolderTree,
  Search,
  ToolMark,
  X,
  Zap,
} from "../components/Icons";
import { PlanStrip } from "../pages/fuel/PlanStrip";
import { useSetModal } from "../app/ModalContext";
import { useViewState } from "../app/ViewStateContext";
import { ChatRow } from "./ChatRow";
import type { RowProps } from "./types";
import { EmptyState } from "./EmptyState";
import { FolderPicker } from "./FolderPicker";
import { folderList, groupBy, groupByFolder, groupChats, mergeLinks, type Group } from "./grouping";
import { useFlip } from "./useFlip";

type Scope = "here" | "all";
const OLDER_STEP = 15;

export function Sidebar() {
  const state = useViewState();
  const setModal = useSetModal();
  const [query, setQuery] = useState("");
  const [tool, setTool] = useState<Tool | "All">(remembered("tool", "All"));
  const [folded, setFolded] = useState<Record<string, boolean>>(remembered("folded", { older: true }));
  const [olderShown, setOlderShown] = useState(OLDER_STEP);
  const [linking, setLinking] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [scope, setScopeState] = useState<Scope>(remembered("scope", "here"));
  // Folders left out of "All folders" (new folders show by default).
  const [hidden, setHiddenState] = useState<string[]>(remembered("hiddenFolders", []));
  const setHidden = (v: string[]) => {
    setHiddenState(v);
    remember("hiddenFolders", v);
  };
  const setScope = (v: Scope) => {
    setScopeState(v);
    remember("scope", v);
    // The board follows: every folder → By folder, this folder → By links.
    send({ type: "scope", scope: v });
  };

  const outgoing = useMemo(() => groupBy(state.connections, (c) => c.from.id), [state.connections]);
  const incoming = useMemo(() => groupBy(state.connections, (c) => c.to.id), [state.connections]);

  const linkedIds = useMemo(() => new Set(state.connections.flatMap((c) => [c.from.id, c.to.id])), [state.connections]);
  const hasElsewhere = useMemo(() => state.sessions.some((s) => s.away), [state.sessions]);
  // Picking chats to link looks in every folder.
  // Picking chats to link has its own view of the folders: it starts on every folder (any chat can
  // be linked) and can be narrowed with the same tabs, folder filter, search and agent chips.
  const [linkScope, setLinkScope] = useState<Scope>("all");
  useEffect(() => {
    if (linking) {
      setLinkScope("all");
      setQuery("");
    }
  }, [linking]);
  const activeScope = linking ? linkScope : scope;
  const everyFolder = activeScope === "all" && hasElsewhere;
  const folders = useMemo(() => folderList(state.sessions, state.root), [state.sessions, state.root]);
  const nothingPicked = everyFolder && folders.length > 0 && folders.every((f) => hidden.includes(f.path));
  const pool = useMemo(() => {
    if (everyFolder) return state.sessions.filter((s) => !hidden.includes(folderOf(s, state.root)) || s.id === linking);
    return state.sessions.filter((s) => !s.away || linkedIds.has(s.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [everyFolder, linking, state.sessions, linkedIds, hidden, state.root]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (s: ChatSession) => s.title.toLowerCase().includes(q) || (s.branch ?? "").toLowerCase().includes(q) || folderName(s.cwd).toLowerCase().includes(q);
    return pool.filter((s) => (tool === "All" || s.tool === tool) && (!q || hit(s)));
  }, [pool, query, tool]);
  const groups = useMemo(() => (everyFolder ? groupByFolder(visible, state.root) : groupChats(visible)), [visible, everyFolder, state.root]);
  const listRef = useRef<HTMLDivElement>(null);
  useFlip(listRef);
  const manyTools = useMemo(() => new Set(state.sessions.map((x) => x.tool)).size > 1, [state.sessions]);
  const linkSource = linking ? state.sessions.find((s) => s.id === linking) : undefined;

  const connectionBetween = (from: string, to: string) => outgoing.get(from)?.find((c) => c.to.id === to);
  // Ticks show at once; the real state replaces them when the extension answers.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  useEffect(() => setOptimistic({}), [state.connections]);
  const isLinked = (to: string) => (linking ? (optimistic[to] ?? !!connectionBetween(linking, to)) : false);
  const toggleLink = (to: string) => {
    if (!linking || linking === to) return;
    const existing = connectionBetween(linking, to);
    const now = isLinked(to);
    setOptimistic((o) => ({ ...o, [to]: !now }));
    if (now && existing) send({ type: "disconnect", connectionId: existing.id });
    else if (!now) send({ type: "connect", from: linking, to });
  };
  const setToolFilter = (t: Tool | "All") => {
    setTool(t);
    remember("tool", t);
  };
  // A folder starts closed unless it is this one or something in it needs you or is working; a
  // heading the person opened or closed stays that way.
  const isFoldedGroup = (g: Group) => (g.key in folded ? folded[g.key] : !!g.folder && g.folder !== state.root && !g.waiting && !g.working);
  const fold = (g: string) => {
    const group = groups.find((x) => x.key === g);
    const next = { ...folded, [g]: !(group ? isFoldedGroup(group) : folded[g]) };
    setFolded(next);
    remember("folded", next);
  };

  const rowProps = (s: ChatSession, g: Group): RowProps => ({
    s,
    nested: !!g.folder,
    showFolder: !!s.away && !g.folder,
    links: mergeLinks(outgoing.get(s.id) ?? [], incoming.get(s.id) ?? []),
    manyTools,
    waiting: state.inbox[s.id]?.count,
    waitingFrom: state.inbox[s.id]?.from,
    expanded: expanded === s.id,
    linking,
    linked: isLinked(s.id),
    dropTarget: over === s.id && !!dragging && dragging !== s.id,
    isDragging: dragging === s.id,
    onToggleExpand: () => setExpanded(expanded === s.id ? null : s.id),
    onLink: () => {
      setExpanded(null);
      setLinking(linking === s.id ? null : s.id);
    },
    onPickLink: () => toggleLink(s.id),
    onBranch: () => {
      setModal({ kind: "loading", label: "Reading the chat…" });
      send({ type: "askBranch", id: s.id });
    },
    drag: {
      draggable: !linking,
      onDragStart: (e: ReactDragEvent) => {
        e.dataTransfer.setData(DRAG_TYPE, s.id);
        e.dataTransfer.effectAllowed = "link";
        setDragging(s.id);
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
      onDragOver: (e: ReactDragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE) || dragging === s.id) return;
        e.preventDefault();
        if (over !== s.id) setOver(s.id);
      },
      onDragLeave: () => over === s.id && setOver(null),
      onDrop: (e: ReactDragEvent) => {
        e.preventDefault();
        const from = e.dataTransfer.getData(DRAG_TYPE);
        setOver(null);
        setDragging(null);
        if (from && from !== s.id) send({ type: "connect", from, to: s.id });
      },
    },
  });

  return (
    <div className="sidebar">
      {linkSource ? (
        <div className="linkbar" role="status">
          <ToolMark tool={linkSource.tool} size={16} />
          <span className="grow">
            <span className="linkbarhint">Pick chats to connect</span>
            <strong className="ellipsis block">{linkSource.title}</strong>
          </span>
          <button className="btn small primary" onClick={() => setLinking(null)}>
            Done
          </button>
        </div>
      ) : (
        !state.loading &&
        !state.hooksOn &&
        state.root && (
          <div className="banner">
            <Zap {...I} size={16} className="bannericon" />
            <span>Turn on auto-sharing so connected chats keep each other up to date.</span>
            <button className="btn small primary" onClick={() => send({ type: "setup" })}>
              Turn on
            </button>
          </div>
        )
      )}
      <>
          {hasElsewhere && (
            <div className="scopebar">
            <div className="scope" role="group" aria-label="Which chats to show">
              {/* Short, fixed words that never get cut off; the folder's own name is in the hint. */}
              <button className={activeScope === "here" ? "on" : ""} aria-pressed={activeScope === "here"} onClick={() => (linking ? setLinkScope("here") : setScope("here"))} data-tip={folderName(state.root) ? `Chats in ${folderName(state.root)}` : undefined}>
                <FolderOpen {...I} size={13} />
                <span className="ellipsis">This folder</span>
              </button>
              <button className={activeScope === "all" ? "on" : ""} aria-pressed={activeScope === "all"} onClick={() => (linking ? setLinkScope("all") : setScope("all"))} data-tip={`Chats in all ${folders.length} folders`}>
                <FolderTree {...I} size={13} />
                <span className="ellipsis">All</span>
                <span className="scopecount">{folders.length}</span>
              </button>
            </div>
            {everyFolder && folders.length > 1 && <FolderPicker folders={folders} hidden={hidden} setHidden={setHidden} root={state.root} />}
            </div>
          )}
          <div className="searchrow">
            <Search {...I} className="muted" />
            <input className="search" placeholder={`Search ${pool.length} chats`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search chats" />
            {query && (
              <button className="icon sm" aria-label="Clear search" onClick={() => setQuery("")}>
                <X {...I} />
              </button>
            )}
          </div>
          {state.tools.length > 1 && (
            <div className="chips" role="group" aria-label="Filter by tool">
              {(["All", ...state.tools] as (Tool | "All")[]).map((t) => (
                <button key={t} className={`chip ${tool === t ? "on" : ""}`} onClick={() => setToolFilter(t)}>
                  {t !== "All" && <ToolMark tool={t} size={12} />} {t}
                </button>
              ))}
            </div>
          )}
      </>

      {state.loading && <p className="hint pulse">Reading your chats…</p>}
      {state.error && <p className="banner warn">{state.error}</p>}

      {/* One continuous list: a chat moving between groups keeps its row (no rebuild, no replayed
          animations), and every row that moves slides to its new place. */}
      <div className="chatlist" ref={listRef}>
        {groups.flatMap((g) => {
          const { key, items } = g;
          // While linking, every folder is open so any chat can be picked.
          const isFolded = !query && !linking && isFoldedGroup(g);
          const shown = key === "older" && !query ? items.slice(0, olderShown) : items;
          const out = [
            <button
              key={`h:${key}`}
              data-flip={`h:${key}`}
              className={`grouphead ${g.folder ? "folder" : key}`}
              onClick={() => fold(key)}
              aria-expanded={!isFolded}
              data-tip={g.folder && g.folder !== state.root ? g.folder : undefined}
            >
              {g.folder ? (
                <>
                  <span className={`ftile ${g.folder === state.root ? "here" : ""}`} aria-label={g.folder === state.root ? "The folder open in this window" : undefined}>
                    {g.folder === state.root ? <FolderOpen {...I} size={15} /> : <Folder {...I} size={15} />}
                  </span>
                  <span className="fmain">
                    <span className="ftop">
                      <span className="fname ellipsis">{g.label}</span>
                      {g.hint && <span className="fhint ellipsis">{g.hint}</span>}
                    </span>
                    {/* Just when it was last active; the blue tile marks the folder open in this window. */}
                    <span className="fmeta">{g.latest ? agoText(g.latest) : ""}</span>
                  </span>
                  <span className="fside">
                    {(g.tools?.length ?? 0) > 1 && (
                      <span className="ftools" aria-label={`Chats from ${g.tools!.join(", ")}`}>
                        {g.tools!.map((t) => (
                          <span key={t} className="ftool">
                            <ToolMark tool={t} size={11} />
                          </span>
                        ))}
                      </span>
                    )}
                    {!!g.waiting && <span className="fdot waiting" aria-label={`${g.waiting} need you`} />}
                    {!!g.working && <span className="fdot working" aria-label={`${g.working} working`} />}
                    <span className="fcount" aria-label={`${items.length} chats`}>
                      {items.length}
                    </span>
                    <ChevronRight {...I} size={14} className={`chev fchev ${isFolded ? "" : "open"}`} />
                  </span>
                </>
              ) : (
                <>
                  <ChevronRight {...I} size={13} className={`chev ${isFolded ? "" : "open"}`} />
                  <span className="grow ellipsis">{g.label}</span>
                  <span className="count">{items.length}</span>
                </>
              )}
            </button>,
          ];
          if (!isFolded) for (const s of shown) out.push(<ChatRow key={s.id} {...rowProps(s, g)} />);
          if (!isFolded && key === "older" && !query && items.length > olderShown)
            out.push(
              <button key="more" data-flip="more" className="linkish more" onClick={() => setOlderShown((n) => n + OLDER_STEP)}>
                Show {Math.min(OLDER_STEP, items.length - olderShown)} more
              </button>,
            );
          return out;
        })}
      </div>

      {!state.loading && !state.error && visible.length === 0 && (
        <EmptyState
          kind={nothingPicked ? "picked" : pool.length ? "search" : "none"}
          query={query.trim()}
          tool={tool}
          folder={folderName(state.root)}
          tools={state.tools.length ? state.tools : ["Claude"]}
          canSeeAll={!everyFolder && hasElsewhere}
          showAll={() => setHidden([])}
          clearSearch={() => {
            setQuery("");
            setToolFilter("All");
          }}
          seeAll={() => setScope("all")}
        />
      )}
      <PlanStrip />
    </div>
  );
}
