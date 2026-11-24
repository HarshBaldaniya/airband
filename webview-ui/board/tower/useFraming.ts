// Fitting the Tower to its window: every card at a readable size, from the top. React Flow's own
// fit shrinks a big board to specks.
import { useCallback, useEffect, useRef } from "react";
import { useReactFlow } from "@xyflow/react";
import type { BoardState } from "../../../src/core/types";
import { READABLE } from "./layout";

/** Room above the cards for the toolbar, and at the sides. */
const TOP = 84;
const SIDE = 32;
const BOTTOM = 28;

export function useFraming(o: { board: BoardState; free: boolean; count: number; initialised: boolean; shape: string }) {
  const flow = useReactFlow();
  const frame = useCallback(
    (opts: { duration?: number } = {}) => {
      const ns = flow.getNodes();
      const pane = document.querySelector(".canvas .react-flow") as HTMLElement | null;
      if (!ns.length || !pane) return;
      // Group panels are nodes, so their headings are inside the bounds.
      const b = flow.getNodesBounds(ns);
      const W = pane.clientWidth;
      const H = pane.clientHeight;
      const fit = Math.min((W - 2 * SIDE) / b.width, (H - TOP - BOTTOM) / b.height);
      const zoom = Math.min(1, Math.max(READABLE, fit));
      const wide = b.width * zoom;
      // Centred when it fits across, from the left edge when it doesn't; always from the top.
      const x = wide <= W - 2 * SIDE ? (W - wide) / 2 - b.x * zoom : SIDE - b.x * zoom;
      const y = TOP - b.y * zoom;
      flow.setViewport({ x, y, zoom }, { duration: opts.duration });
    },
    [flow],
  );

  // One framing waits at a time, while the layout or the window settles. Unmounting drops it.
  const later = useRef<ReturnType<typeof setTimeout>>(undefined);
  const frameSoon = useCallback(
    (delay: number, opts: { duration?: number } = {}) => {
      clearTimeout(later.current);
      later.current = setTimeout(() => frame(opts), delay);
    },
    [frame],
  );
  useEffect(() => () => clearTimeout(later.current), []);

  // Fit once the cards have been measured, and again whenever the layout itself changes shape
  // (another arrangement, more or fewer cards per row, cards added or taken off), once it has settled.
  const fitted = useRef(false);
  const framedCount = useRef(0);
  const { board, free, count, initialised, shape } = o;
  useEffect(() => {
    if (!initialised || !count) return;
    const first = !fitted.current;
    fitted.current = true;
    const added = count !== framedCount.current;
    framedCount.current = count;
    // Laid out by hand, the board opens where the person left the view, and keeps it (a drag into
    // "free" doesn't move the view); only cards added or taken off frame it again. An arrangement is framed.
    const saved = first && free ? board.viewport : undefined;
    if (!first && free && !added) return;
    const t = setTimeout(() => (saved ? flow.setViewport(saved) : frame(first ? {} : { duration: 300 })), first ? 0 : 120);
    return () => clearTimeout(t);
    // The saved view is read once, as the board opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialised, count, flow, free, shape, frame]);

  return { frame, frameSoon };
}
