// One keyboard listener for the whole page. Each part of the page adds its keys as a layer, and a
// key goes to the layer in front first: the shortcut sheet, then a dialog, then an open menu, then
// the page, then the keys that switch pages. The first layer that handles a key keeps it, so an Esc
// closes one thing at a time.
import { useEffect, useRef } from "react";

export const LAYER = { tabs: 0, page: 1, menu: 2, dialog: 3, sheet: 4 } as const;

/** A layer's keys. Returning true means handled: the layers behind it don't hear the key. */
export type KeyHandler = (e: KeyboardEvent) => boolean | void;

interface Layer {
  rank: number;
  seq: number;
  handle: { current: KeyHandler };
}

const layers: Layer[] = [];
let seq = 0;

function dispatch(e: KeyboardEvent): void {
  const inFront = [...layers].sort((a, b) => b.rank - a.rank || b.seq - a.seq);
  for (const l of inFront) if (l.handle.current(e) === true) return;
}

/** Adds `handler` as a layer of keys while `enabled`. Of two layers at one rank, the newer is in front. */
export function useKeys(rank: number, handler: KeyHandler, enabled = true): void {
  const handle = useRef(handler);
  useEffect(() => {
    handle.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    const layer: Layer = { rank, seq: ++seq, handle };
    if (!layers.length) window.addEventListener("keydown", dispatch);
    layers.push(layer);
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      if (!layers.length) window.removeEventListener("keydown", dispatch);
    };
  }, [rank, enabled]);
}
