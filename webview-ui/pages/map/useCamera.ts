// The Map's camera: where it looks and how close. It lives outside React, in the page's `live`
// object, so panning and zooming never re-render the page. Wheel and trackpad zoom around the pointer.
import { useEffect, type RefObject } from "react";
import type { Cam } from "./model";

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 6;
/** How long a flight to a part or file takes. */
const FLIGHT_MS = 420;

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** The camera at zoom `k` that keeps the world point under screen point (px, py) where it is.
 *  Screen points are from the canvas's middle. */
function zoomAround(cam: Cam, px: number, py: number, k: number): Cam {
  const wx = cam.x + px / cam.k;
  const wy = cam.y + py / cam.k;
  return { k, x: wx - px / k, y: wy - py / k };
}

export interface CameraState {
  cam: Cam;
  w: number;
  h: number;
  tween?: { from: Cam; to: Cam; t0: number };
}

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Moves a flight on to `now`. True while it is still under way. */
export function stepFlight(live: CameraState, now: number): boolean {
  if (!live.tween) return false;
  const p = Math.min(1, (now - live.tween.t0) / FLIGHT_MS);
  const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  const { from, to } = live.tween;
  live.cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k * Math.pow(to.k / from.k, e) };
  if (p >= 1) live.tween = undefined;
  return true;
}

export function useCamera(canvasRef: RefObject<HTMLCanvasElement | null>, live: CameraState, redraw: () => void, enabled: boolean) {
  const flyTo = (to: Cam) => {
    if (reduced()) live.cam = to;
    else live.tween = { from: { ...live.cam }, to, t0: performance.now() };
    redraw();
  };
  const zoomBy = (f: number) => flyTo({ ...live.cam, k: clampZoom(live.cam.k * f) });
  /** A point on the screen, in world units. */
  const toWorld = (cx: number, cy: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: live.cam.x + (cx - r.left - live.w / 2) / live.cam.k, y: live.cam.y + (cy - r.top - live.h / 2) / live.cam.k };
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      live.tween = undefined;
      const r = c.getBoundingClientRect();
      // A trackpad pinch arrives as a wheel with ctrl held, in small steps.
      const k = clampZoom(live.cam.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
      live.cam = zoomAround(live.cam, e.clientX - r.left - live.w / 2, e.clientY - r.top - live.h / 2, k);
      redraw();
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
    // `live` is the page's one object for the whole time it is open, and redraw only asks for a frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { flyTo, zoomBy, toWorld };
}
