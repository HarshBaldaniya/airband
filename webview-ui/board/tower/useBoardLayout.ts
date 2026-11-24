// Where every card and group panel sits, kept in step with the data. Every arrangement is live and
// follows the data; "free" is the person's own layout after a drag.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEdgesState, useNodesInitialized, useNodesState, useReactFlow, useStore, type Node } from "@xyflow/react";
import type { ViewState } from "../../../src/core/protocol";
import type { BoardPosition, ChatSession } from "../../../src/core/types";
import { send } from "../../lib/vscode";
import { cardLinks, lineEdges } from "./edges";
import { autoLayout, CARD_W, LANE_HEAD, LANE_PAD, laneLayout, READABLE, spreadDown, type ArrangeMode, type Lane } from "./layout";
import type { CardNode, LineEdge } from "./types";

/** How often lines check whether their last update is still fresh. */
const TICK_MS = 4000;

export function useBoardLayout(state: ViewState, arrangeMode: ArrangeMode | "free", members: string[], byId: Map<string, ChatSession>) {
  const flow = useReactFlow();
  const initialised = useNodesInitialized();
  const live = arrangeMode !== "free";
  const memberSet = useMemo(() => new Set(members), [members]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // The room the board shows at a readable size, in board units (in steps, so a small resize
  // doesn't shuffle the cards). Group layouts are cut to fit it: panels no taller than the board,
  // as many side by side as fit across.
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);
  const step = (n: number) => Math.max(320, Math.round(n / 80) * 80);
  const viewW = paneW > 0 ? step((paneW - 64) / READABLE) : 1440;
  const viewH = paneH > 0 ? step((paneH - 84 - 28) / READABLE) : 960;

  // Laid out again whenever a card's real height changes (see `heights` below).
  const [measureTick, setMeasureTick] = useState(0);
  const liveLayout = useMemo(() => {
    if (!live) return null;
    const sizes: Record<string, { w: number; h: number }> = {};
    for (const n of flow.getNodes()) if (n.type === "chat") sizes[n.id] = { w: n.measured?.width ?? CARD_W, h: n.measured?.height ?? 230 };
    if (arrangeMode === "links") return { positions: autoLayout(members, state.connections, sizes), lanes: [] as Lane[] };
    return laneLayout(
      members.map((id) => byId.get(id)!),
      arrangeMode,
      sizes,
      state.root,
      { w: viewW, h: viewH },
    );
    // measureTick asks for the cards' new sizes, which React Flow keeps outside React.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, arrangeMode, members, byId, measureTick, state.connections, state.root, viewW, viewH]);
  const lanes: Lane[] = liveLayout?.lanes ?? [];

  const wanted = useMemo<CardNode[]>(() => {
    const auto = autoLayout(members, state.connections);
    return members.map((id) => ({
      id,
      type: "chat",
      dragHandle: ".bcardhead",
      position: liveLayout?.positions[id] ?? state.board.positions[id] ?? auto[id],
      data: {
        s: byId.get(id)!,
        links: cardLinks(id, state.connections),
        waiting: state.inbox[id]?.count,
        from: state.inbox[id]?.from,
        inPanel: arrangeMode === "folder",
      },
    }));
  }, [members, byId, state.board.positions, state.connections, state.inbox, liveLayout, arrangeMode]);
  const wantedEdges = useMemo(() => lineEdges(state.connections, memberSet, state.board.handles, now), [state.connections, memberSet, now, state.board.handles]);

  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>(wanted);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LineEdge>(wantedEdges);
  // Places set here (a drop, a card pushed down) until Airband's saved layout says the same: so a
  // card never jumps back to where it was while the save is on its way.
  const placed = useRef<Record<string, BoardPosition>>({});
  const place = useCallback((moves: Record<string, BoardPosition>) => Object.assign(placed.current, moves), []);
  useEffect(() => {
    for (const [id, p] of Object.entries(placed.current)) {
      const saved = state.board.positions[id];
      if (saved && Math.abs(saved.x - p.x) < 1 && Math.abs(saved.y - p.y) < 1) delete placed.current[id];
    }
  }, [state.board.positions]);
  useEffect(() => {
    setNodes((cur) => {
      const was = new Map(cur.map((n) => [n.id, n]));
      // Keep what React Flow knows about each card (its measured size, selection, drag): a card
      // without its measured size is hidden by React Flow and stops taking clicks.
      return wanted.map((n) => {
        const old = was.get(n.id);
        return {
          ...old,
          ...n,
          measured: old?.measured,
          selected: old?.selected,
          dragging: old?.dragging,
          // Arranged: where the arrangement puts it. By hand: where the person put it (as saved),
          // never where an arrangement shown a moment before had put it.
          position:
            liveLayout?.positions[n.id] ??
            (old?.dragging ? old.position : undefined) ??
            placed.current[n.id] ??
            state.board.positions[n.id] ??
            old?.position ??
            n.position,
        };
      });
    });
  }, [wanted, setNodes, state.board.positions, liveLayout]);
  useEffect(() => setEdges(wantedEdges), [wantedEdges, setEdges]);

  // Lay out again whenever a card's real height changes (a link adds a line, a chat starts
  // waiting...), so cards never overlap or spill out of their group's panel.
  const heights = useMemo(() => nodes.map((n) => `${n.id}:${Math.round(n.measured?.height ?? 0)}`).join(","), [nodes]);
  useEffect(() => {
    if (initialised) setMeasureTick((t) => t + 1);
  }, [initialised, heights]);
  // Placed by hand ("free"), cards stay where the person put them, but a card that grows (its
  // folder line back after leaving "By folder", a new link, a chat waiting...) pushes the cards
  // under it down, so every card stays one unit clear of the next. Nothing is ever pulled up.
  useEffect(() => {
    if (live || !initialised) return;
    const cards = flow.getNodes().filter((n) => n.type === "chat");
    if (!cards.length || cards.some((n) => n.dragging || !n.measured?.height)) return;
    const moved = spreadDown(cards.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.measured?.width ?? CARD_W, h: n.measured!.height! })));
    if (!Object.keys(moved).length) return;
    place(moved);
    setNodes((ns) => ns.map((n) => (moved[n.id] ? { ...n, position: moved[n.id] } : n)));
    send({ type: "arrange", positions: moved });
  }, [live, initialised, heights, flow, place, setNodes]);

  // Group panels ("By time", "By agent", "By folder") are nodes drawn behind the cards.
  const laneNodes = useMemo<Node[]>(
    () =>
      lanes.map((l) => {
        const width = l.w + 2 * LANE_PAD;
        const height = l.h + LANE_HEAD + LANE_PAD;
        return {
          id: `lane:${l.folder ?? l.label}`,
          type: "lane",
          position: { x: l.x - LANE_PAD, y: l.y - LANE_HEAD },
          data: { lane: l },
          draggable: false,
          selectable: false,
          connectable: false,
          deletable: false,
          focusable: false,
          zIndex: -1,
          // Their size is known exactly, so they never wait to be measured (an unmeasured node is hidden).
          width,
          height,
          measured: { width, height },
          style: { width, height },
        };
      }),
    [lanes],
  );

  return { nodes, setNodes, onNodesChange, edges, onEdgesChange, lanes, laneNodes, memberSet, place, live, initialised, viewW, viewH };
}
