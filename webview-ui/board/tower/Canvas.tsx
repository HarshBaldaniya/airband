// The Tower: chats as cards on a canvas, links as moving lines.
//   • Drag a chat from the tray onto the canvas (or press +) to show it.
//   • Drag from a card's dot to another card, or drop a card on a card, to link them.
//   • Click a line's label to pause, make it two-way or unlink.
//   • Arrange lays the cards out by channels, time, agent or folder.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, ConnectionMode, ControlButton, Controls, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Node } from "@xyflow/react";
import type { BoardArrange, BoardPosition } from "../../../src/core/types";
import { useViewState } from "../../app/ViewStateContext";
import { DRAG_TYPE, folderName } from "../../lib/folders";
import { remember, remembered, send } from "../../lib/vscode";
import { ArrowLeftRight, I, LayoutGrid, Link2, PanelLeftOpen, Plus, Scan } from "../../components/Icons";
import { ChatCard } from "./ChatCard";
import { LaneBox } from "./LaneBox";
import { CARD_H, CARD_W, clearOf, UNIT, type ArrangeMode } from "./layout";
import { LinkLine } from "./LinkLine";
import { Toolbar } from "./Toolbar";
import { Tray } from "./Tray";
import { LinkMode, type CardNode } from "./types";
import { useBoardKeys } from "./useBoardKeys";
import { useBoardLayout } from "./useBoardLayout";
import { useFraming } from "./useFraming";

const NODE_TYPES = { chat: ChatCard, lane: LaneBox };
const EDGE_TYPES = { link: LinkLine };
/** The side panels take a moment to go or come back before the board can be fitted again. */
const FOCUS_SETTLES_MS = 450;
/** The view is saved this long after it stops moving. */
const VIEW_SAVE_MS = 400;

export function Tower() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}

function Canvas() {
  const state = useViewState();
  const flow = useReactFlow();
  const dragStart = useRef<BoardPosition | null>(null);
  // The chat list starts open only when there is room for it beside the canvas.
  const [trayOpen, setTrayOpen] = useState<boolean>(() => remembered("tray", window.innerWidth > 900));
  const byId = useMemo(() => new Map(state.sessions.map((s) => [s.id, s])), [state.sessions]);

  // The layout is kept with the workspace (the extension stores it), so it survives closing the
  // board, and the sidebar's "All folders" sets it to By folder. What the saved board says is read
  // as it renders (so a board opened fresh never shows another arrangement first); a pick made
  // here shows at once, until the saved board says something new.
  const [picked, setPicked] = useState<ArrangeMode | "free" | undefined>();
  useEffect(() => setPicked(undefined), [state.board.arrange]);
  const saved = picked ?? state.board.arrange ?? remembered<ArrangeMode | "free">("arrangeMode", "links");
  const arrangeMode: ArrangeMode | "free" = saved === "status" ? "links" : saved;
  const pickArrangement = (mode: ArrangeMode | "free") => {
    setPicked(mode);
    remember("arrangeMode", mode);
    send({ type: "boardArrange", arrange: mode as BoardArrange });
  };

  // Every arrangement shows the board's own cards: what the person put on it (so clearing it
  // really clears it), added back a folder at a time or one by one from the chat list.
  const members = useMemo(() => state.board.members.filter((id) => byId.has(id)), [state.board.members, byId]);
  const layout = useBoardLayout(state, arrangeMode, members, byId);
  const { nodes, setNodes, edges, place, live } = layout;
  const { frame, frameSoon } = useFraming({
    board: state.board,
    free: arrangeMode === "free",
    count: nodes.length,
    initialised: layout.initialised,
    shape: `${arrangeMode}:${layout.viewW}x${layout.viewH}:${layout.lanes.length}`,
  });

  const viewSave = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(viewSave.current), []);
  const [query, setQuery] = useState("");
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const linkMode = useMemo(() => ({ from: linkFrom, start: (id: string) => setLinkFrom((cur) => (cur === id ? null : id)) }), [linkFrom]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q ? members.filter((id) => byId.get(id)!.title.toLowerCase().includes(q)) : []), [q, members, byId]);
  const shownNodes = useMemo<Node[]>(
    () => [...layout.laneNodes, ...(q ? nodes.map((n) => ({ ...n, className: matches.includes(n.id) ? "match" : "dimmed" })) : nodes)],
    [layout.laneNodes, nodes, q, matches],
  );
  const findMatches = () => matches.length && flow.fitView({ nodes: matches.map((id) => ({ id })), padding: 0.4, maxZoom: 1, duration: 400 });
  const dark = !document.body.classList.contains("vscode-light") && !document.body.classList.contains("vscode-high-contrast-light");
  const toggleTray = () => {
    remember("tray", !trayOpen);
    setTrayOpen(!trayOpen);
  };
  const [connecting, setConnecting] = useState(false);
  const selected = nodes.filter((n) => n.selected).map((n) => n.id);
  const deselect = useCallback(() => setNodes((ns) => ns.map((n) => ({ ...n, selected: false }))), [setNodes]);
  const link = (from: string, to: string) => from !== to && send({ type: "connect", from, to });
  /** A line drawn to or from a selected group links the whole group. */
  const linkFromLine = (source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null) => {
    if (source === target) return;
    const handles = sourceHandle && targetHandle ? { [`${source}>${target}`]: { s: sourceHandle, t: targetHandle } } : undefined;
    let pairs: [string, string][] = [[source, target]];
    if (selected.length > 1 && selected.includes(source) && !selected.includes(target)) pairs = selected.map((id) => [id, target]);
    else if (selected.length > 1 && selected.includes(target) && !selected.includes(source)) pairs = selected.map((id) => [source, id]);
    send({ type: "connectMany", pairs, handles });
  };
  const linkAllTogether = () => {
    const pairs: [string, string][] = [];
    for (const a of selected) for (const b of selected) if (a !== b) pairs.push([a, b]);
    send({ type: "connectMany", pairs });
  };
  const arrange = (mode: ArrangeMode) => {
    pickArrangement(mode);
    frameSoon(60, { duration: 350 });
  };
  const toggleFocus = () => {
    send({ type: "fullscreen" });
    frameSoon(FOCUS_SETTLES_MS, { duration: 300 });
  };

  const searchRef = useRef<HTMLInputElement>(null);
  useBoardKeys({
    searchRef,
    linking: !!linkFrom,
    stopLinking: () => setLinkFrom(null),
    query,
    clearQuery: () => setQuery(""),
    anySelected: () => flow.getNodes().some((n) => n.selected),
    deselect,
    focus: !!state.focus,
    toggleFocus,
    toggleTray,
    newChat: () => send({ type: "newChat", tool: "Claude" }),
    fit: () => frame({ duration: 300 }),
    arrange: members.length ? arrange : undefined,
  });

  const onDragStop = (node: CardNode) => {
    const hit = flow.getIntersectingNodes(node).find((n) => n.id !== node.id && n.type === "chat");
    if (hit && dragStart.current) {
      // A card dropped on a card links them; it goes back to where it was.
      const back = dragStart.current;
      setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, position: back } : n)));
      link(node.id, hit.id);
    } else {
      // Dropped close to another card: moved to the nearest spot one unit clear of every card.
      const others = flow
        .getNodes()
        .filter((n) => n.type === "chat" && n.id !== node.id)
        .map((n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? CARD_W, h: n.measured?.height ?? CARD_H }));
      const settled = clearOf(node.position, { w: node.measured?.width ?? CARD_W, h: node.measured?.height ?? CARD_H }, others);
      if (settled.x !== node.position.x || settled.y !== node.position.y) setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, position: settled } : n)));
      place({ [node.id]: settled });
      if (live) {
        // Moving a card by hand leaves the live columns: the layout becomes the person's own.
        const positions: Record<string, BoardPosition> = {};
        for (const n of flow.getNodes()) if (n.type === "chat") positions[n.id] = n.id === node.id ? settled : n.position;
        place(positions);
        send({ type: "arrange", positions });
        pickArrangement("free");
      } else {
        send({ type: "move", id: node.id, x: settled.x, y: settled.y });
      }
    }
    dragStart.current = null;
  };

  return (
    <div className="boardbody">
      {/* The chat list slides in and out (it stays mounted, so closing animates too); the board
          eases over to make room. Closed, it is inert: no focus or clicks reach it. */}
      <div className={`traywrap ${trayOpen ? "open" : ""}`} aria-hidden={!trayOpen} inert={!trayOpen}>
        <Tray onBoard={layout.memberSet} close={toggleTray} />
      </div>
      <div
        className={`canvas ${connecting ? "is-connecting" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(DRAG_TYPE);
          if (!id) return;
          e.preventDefault();
          const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
          send({ type: "boardAdd", id, x: p.x - CARD_W / 2, y: p.y - 30 });
        }}
      >
        <LinkMode.Provider value={linkMode}>
          <ReactFlow
            onMoveEnd={(_, v) => {
              // Kept with the board, for the next time it opens.
              clearTimeout(viewSave.current);
              viewSave.current = setTimeout(() => send({ type: "viewport", viewport: { x: Math.round(v.x), y: Math.round(v.y), zoom: Math.round(v.zoom * 1000) / 1000 } }), VIEW_SAVE_MS);
            }}
            nodes={shownNodes as CardNode[]}
            onNodeClick={(_, node) => {
              if (linkFrom && node.id !== linkFrom) {
                send({ type: "connectMany", pairs: [[linkFrom, node.id]] });
                setLinkFrom(null);
              }
            }}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={layout.onNodesChange}
            onEdgesChange={layout.onEdgesChange}
            colorMode={dark ? "dark" : "light"}
            minZoom={0.3}
            maxZoom={1.6}
            nodesConnectable
            deleteKeyCode={["Backspace", "Delete"]}
            onEdgesDelete={(es) => send({ type: "disconnectMany", ids: es.flatMap((e) => [e.data?.forward?.id, e.data?.back?.id].filter((x): x is string => !!x)) })}
            onNodesDelete={(ns) => ns.forEach((n) => send({ type: "boardRemove", id: n.id }))}
            connectionRadius={26}
            connectionMode={ConnectionMode.Loose}
            connectOnClick
            onConnectStart={() => setConnecting(true)}
            onConnectEnd={() => setConnecting(false)}
            multiSelectionKeyCode={["Meta", "Control", "Shift"]}
            proOptions={{ hideAttribution: true }}
            isValidConnection={(c) => c.source !== c.target}
            snapToGrid
            snapGrid={[UNIT / 2, UNIT / 2]}
            onConnect={(c: Connection) => c.source && c.target && linkFromLine(c.source, c.target, c.sourceHandle, c.targetHandle)}
            onNodeDragStart={(_, node) => (dragStart.current = { ...node.position })}
            onNodeDragStop={(_, node) => onDragStop(node)}
          >
            <Background gap={22} size={1.2} />
            {linkFrom && (
              <Panel position="top-center" className="selbar linkbanner">
                <Link2 {...I} size={14} />
                <span>
                  Click a card to link it with <b>{byId.get(linkFrom)?.title}</b>
                </span>
                <button className="btn small ghost" onClick={() => setLinkFrom(null)}>
                  Cancel
                </button>
              </Panel>
            )}
            {selected.length > 1 && (
              <Panel position="top-center" className="selbar">
                <span>
                  <b>{selected.length} chats selected.</b> Draw a line to or from any of them to link the whole group.
                </span>
                <button className="btn small primary" onClick={linkAllTogether}>
                  <ArrowLeftRight {...I} size={13} /> Link all together
                </button>
                <button className="btn small ghost" onClick={deselect}>
                  Clear
                </button>
              </Panel>
            )}
            <Toolbar
              trayOpen={trayOpen}
              toggleTray={toggleTray}
              searchRef={searchRef}
              query={query}
              setQuery={setQuery}
              matchCount={matches.length}
              findMatches={findMatches}
              hasCards={members.length > 0}
              arrangeMode={arrangeMode}
              arrange={arrange}
              toggleFocus={toggleFocus}
            />
            {/* What the line styles mean, only while there are lines to read. */}
            {edges.length > 0 && (
              <Panel position="bottom-left" className="legendpanel">
                <span className="legend">
                  <span className="swatch live" /> sharing
                </span>
                <span className="legend">
                  <span className="swatch paused" /> paused
                </span>
              </Panel>
            )}
            <Controls showInteractive={false} showFitView={false} position="bottom-right">
              <ControlButton onClick={() => frame({ duration: 300 })} aria-label="Fit the Tower" title="Fit the Tower (0)">
                <Scan {...I} size={13} />
              </ControlButton>
            </Controls>
          </ReactFlow>
        </LinkMode.Provider>
        {!state.loading && members.length === 0 && (
          <div className="boardempty">
            <span className="emptyicon">
              <LayoutGrid {...I} size={22} />
            </span>
            <p className="strong">Your Tower is empty</p>
            <p className="muted small">Add the chats you want to see: a whole folder at once, or one by one from the list.</p>
            <div className="boardemptyactions">
              {state.sessions.some((x) => !x.away) && (
                <button className="btn primary" onClick={() => state.sessions.filter((x) => !x.away).forEach((x) => send({ type: "boardAdd", id: x.id }))}>
                  <Plus {...I} size={13} /> Add {folderName(state.root) || "this folder"}’s chats
                </button>
              )}
              {!trayOpen && (
                <button className="btn" onClick={toggleTray}>
                  <PanelLeftOpen {...I} size={13} /> Show the chat list
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
