// The Map: one project as a board to explore. Each part is a small galaxy of its files; parts of
// a folder sit together in a soft cloud. Drag a part to move it (it stays put), drag the board to pan,
// scroll or pinch to zoom. Hover or click a part or a file to see what it uses (blue) and what uses it
// (orange). Built by a parser on this computer, no AI.
import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, Maximize2, Minus, Plus, Search, X } from "lucide-react";
import type { CodeHitView, CodeMapView } from "../../../src/vscode/protocol";
import { useViewState } from "../../app/ViewStateContext";
import { LAYER, useKeys } from "../../lib/useKeys";
import { onMessage, remember, remembered, send } from "../../lib/vscode";
import { typing } from "../../lib/keys";
import { I } from "../../components/Icons";
import { buildModel, dotX, dotY, fitCam, hitTest, litFor, sameTarget, type Cam, type Model, type Target, type Theme } from "./model";
import { ProjectPicker } from "./ProjectPicker";
import { draw } from "./render";
import { clampZoom, stepFlight, useCamera, type CameraState } from "./useCamera";


const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const partPath = (id: string) => (id === "." ? "top-level files" : `${id}/`);
/** The name with what was typed in bold. */
function marked(name: string, q: string) {
  const word = q.split(/\s+/).find((w) => w && name.toLowerCase().includes(w.toLowerCase()));
  if (!word) return name;
  const at = name.toLowerCase().indexOf(word.toLowerCase());
  return (
    <>
      {name.slice(0, at)}
      <b>{name.slice(at, at + word.length)}</b>
      {name.slice(at + word.length)}
    </>
  );
}

function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el);
  const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  return { fg: v("--vscode-foreground", "#cccccc"), bg: v("--vscode-editor-background", "#1e1e1e"), uses: v("--tm-uses", "#3987e5"), usedby: v("--tm-usedby", "#d95926"), focus: v("--vscode-focusBorder", "#4f8cff") };
}

/** Everything the canvas needs between frames, kept out of React so moving the pointer doesn't re-render. */
interface Live extends CameraState {
  model?: Model;
  hover?: Target;
  selected?: Target;
  fade: number;
  pulse?: { i: number; t: number };
  theme?: Theme;
  raf: number;
  fitted?: string;
  /** Files the search found, glowing on the board */
  found?: Set<number>;
}

export function MapPage() {
  const state = useViewState();
  const [data, setData] = useState<CodeMapView | undefined>();
  const [root, setRoot] = useState<string | undefined>(() => remembered<string | undefined>("codeRoot", undefined));
  const [selected, setSelected] = useState<Target | undefined>();
  const [hover, setHover] = useState<Target | undefined>();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ q: string; hits: CodeHitView[] } | undefined>();
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(0);
  const [layoutKey, setLayoutKey] = useState(0);
  const [shape, setShape] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const live = useRef<Live>({ cam: { x: 0, y: 0, k: 1 }, w: 0, h: 0, fade: 0, raf: 0 }).current;

  useEffect(
    () =>
      onMessage((m) => {
        if (m.type === "codeMap") {
          setData(m.data);
        }
        if (m.type === "codeFind") setHits({ q: m.q, hits: m.hits });
        if (m.type === "codeRoot") {
          setRoot(m.root);
          remember("codeRoot", m.root);
        }
      }),
    [],
  );
  useEffect(() => {
    setSelected(undefined);
    send({ type: "codeMap", root });
  }, [root, state.root]);
  useEffect(() => {
    if (!q.trim()) return setHits(undefined);
    const t = setTimeout(() => send({ type: "codeFind", q: q.trim(), root: data?.root }), 160);
    return () => clearTimeout(t);
  }, [q, data?.root]);

  const shown = hits && hits.q === q.trim() ? hits.hits.filter((h, n, all) => all.findIndex((x) => x.name === h.name && x.path === h.path) === n).slice(0, 8) : [];
  useEffect(() => {
    const m = live.model;
    live.found = m && shown.length ? new Set(shown.map((h) => m.dotByPath.get(h.path)?.i).filter((i): i is number => i !== undefined)) : undefined;
    redraw();
  }, [hits, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinKey = data ? `codePins:${data.root}` : "";
  const model = useMemo(() => {
    if (!data || !data.modules.length) return undefined;
    return buildModel(data, remembered<Record<string, [number, number]>>(pinKey, {}), Math.pow(2, shape));
  }, [data, pinKey, layoutKey, shape]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPinned(pinKey ? Object.keys(remembered<Record<string, unknown>>(pinKey, {})).length : 0), [pinKey, layoutKey]);

  // ---- the frame loop: runs only while something moves
  const frame = (now: number) => {
    live.raf = 0;
    const m = live.model;
    const c = canvasRef.current;
    if (!m || !c || !live.w) return;
    let busy = false;
    if (m.sim.alpha() > 0.004) {
      m.sim.tick();
      busy = true;
    }
    const want = live.hover || live.selected ? 1 : 0;
    if (live.fade !== want) {
      live.fade = reduced() ? want : want > live.fade ? Math.min(1, live.fade + 0.14) : Math.max(0, live.fade - 0.14);
      busy = true;
    }
    if (stepFlight(live, now)) busy = true;
    if (live.pulse && now - live.pulse.t < 3000 && !reduced()) busy = true;
    // Light flows along the wires of whatever is in focus.
    if ((live.hover || live.selected) && !reduced()) busy = true;
    const ctx = c.getContext("2d");
    if (ctx) draw(ctx, m, { w: live.w, h: live.h, dpr: window.devicePixelRatio || 1, cam: live.cam, theme: live.theme ?? readTheme(c), lit: litFor(m, live.hover ?? live.selected), fade: live.fade, hover: live.hover, selected: live.selected, pulse: live.pulse, found: live.found, now, still: reduced() });
    if (busy) live.raf = requestAnimationFrame(frame);
  };
  const redraw = () => {
    if (!live.raf) live.raf = requestAnimationFrame(frame);
  };
  const { flyTo, zoomBy, toWorld } = useCamera(canvasRef, live, redraw, !!model);
  // Over a wide board the project and search float on top: leave them room.
  const topRoom = () => (live.w > 640 ? 64 : 0);
  const fitNow = () => live.model && fitCam(live.model, live.w, live.h, topRoom());
  const fit = () => live.model && flyTo(fitNow()!);

  useEffect(() => {
    live.model = model;
    // A new project starts framed; the same one keeps where you were looking.
    if (model && data && live.w && live.fitted !== `${data.root}:${shape}`) {
      live.cam = fitNow()!;
      live.fitted = `${data.root}:${shape}`;
    }
    live.hover = undefined;
    setHover(undefined);
    redraw();
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    live.selected = selected;
    redraw();
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Size the canvas to the board, sharp on every screen.
  useEffect(() => {
    const el = boardRef.current;
    const c = canvasRef.current;
    if (!el || !c) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      const h = Math.round(e.contentRect.height);
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      c.width = w * dpr;
      c.height = h * dpr;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      live.w = w;
      live.h = h;
      // The layout follows the board's shape, in steps, so a small resize doesn't move anything.
      setShape(Math.max(-2, Math.min(2, Math.round(Math.log2(h / w) * 2) / 2)));
      if (live.model && data && live.fitted !== `${data.root}:${shape}`) {
        live.cam = fitNow()!;
        live.fitted = `${data.root}:${shape}`;
      }
      live.theme = readTheme(c);
      redraw();
    });
    ro.observe(el);
    // The theme can change while the page is open.
    const mo = new MutationObserver(() => {
      live.theme = readTheme(c);
      redraw();
    });
    mo.observe(document.body, { attributes: true, attributeFilter: ["class", "data-vscode-theme-kind"] });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [data?.root, !!model]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tests (and tools) can ask where a part or a file is drawn.
  useEffect(() => {
    const c = canvasRef.current as (HTMLCanvasElement & { where?: (id: string) => { x: number; y: number } | undefined }) | null;
    if (!c) return;
    c.where = (id: string) => {
      const m = live.model;
      if (!m) return undefined;
      const s = m.byId.get(id);
      const d = s ? undefined : m.dotByPath.get(id);
      if (!s && !d) return undefined;
      const wx = s ? (s.x ?? 0) : dotX(d!);
      const wy = s ? (s.y ?? 0) : dotY(d!);
      const r = c.getBoundingClientRect();
      return { x: r.left + live.w / 2 + (wx - live.cam.x) * live.cam.k, y: r.top + live.h / 2 + (wy - live.cam.y) * live.cam.k };
    };
  });

  // ---- pointer: hover, click, drag a part, pan, pinch, wheel
  const ptrs = useRef(new Map<number, { x: number; y: number }>()).current;
  const gesture = useRef<{ mode: "pan" | "part" | "pinch"; x: number; y: number; moved: boolean; target?: Target; offX: number; offY: number; cam: Cam; d0?: number; id?: string } | undefined>(undefined);
  const setHoverTarget = (t: Target | undefined) => {
    if (sameTarget(t, live.hover) || (!t && !live.hover)) return;
    live.hover = t;
    setHover(t);
    redraw();
  };
  const placeCard = (cx: number, cy: number) => {
    const el = cardRef.current;
    const b = boardRef.current?.getBoundingClientRect();
    if (!el || !b) return;
    const x = Math.min(cx - b.left + 14, b.width - el.offsetWidth - 8);
    const y = cy - b.top + 16 + el.offsetHeight > b.height - 8 ? cy - b.top - el.offsetHeight - 12 : cy - b.top + 16;
    el.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const m = live.model;
    if (!m) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    live.tween = undefined;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      gesture.current = { mode: "pinch", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, moved: true, offX: 0, offY: 0, cam: { ...live.cam }, d0: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const t = hitTest(m, w.x, w.y, live.cam.k);
    if (t) {
      const sys = t.kind === "part" ? m.byId.get(t.id)! : m.dots[t.i].part;
      gesture.current = { mode: "part", x: e.clientX, y: e.clientY, moved: false, target: t, offX: w.x - (sys.x ?? 0), offY: w.y - (sys.y ?? 0), cam: { ...live.cam }, id: sys.id };
    } else gesture.current = { mode: "pan", x: e.clientX, y: e.clientY, moved: false, offX: 0, offY: 0, cam: { ...live.cam } };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const m = live.model;
    if (!m) return;
    const g = gesture.current;
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!g) {
      const w = toWorld(e.clientX, e.clientY);
      const t = hitTest(m, w.x, w.y, live.cam.k);
      setHoverTarget(t);
      e.currentTarget.style.cursor = t ? "pointer" : "grab";
      placeCard(e.clientX, e.clientY);
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return;
    g.moved = true;
    setHoverTarget(undefined);
    if (g.mode === "pan") {
      live.cam = { ...g.cam, x: g.cam.x - (e.clientX - g.x) / g.cam.k, y: g.cam.y - (e.clientY - g.y) / g.cam.k };
      e.currentTarget.style.cursor = "grabbing";
    } else if (g.mode === "part" && g.id) {
      const s = m.byId.get(g.id)!;
      const w = toWorld(e.clientX, e.clientY);
      s.fx = w.x - g.offX;
      s.fy = w.y - g.offY;
      m.sim.alphaTarget(0.2);
      if (m.sim.alpha() < 0.2) m.sim.alpha(0.2);
      e.currentTarget.style.cursor = "grabbing";
    } else if (g.mode === "pinch" && ptrs.size === 2 && g.d0) {
      const [a, b] = [...ptrs.values()];
      const k = clampZoom(g.cam.k * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0));
      const r = canvasRef.current!.getBoundingClientRect();
      // The world point under where the pinch began stays under the fingers' middle.
      const wx = g.cam.x + (g.x - r.left - live.w / 2) / g.cam.k;
      const wy = g.cam.y + (g.y - r.top - live.h / 2) / g.cam.k;
      const mx = (a.x + b.x) / 2 - r.left - live.w / 2;
      const my = (a.y + b.y) / 2 - r.top - live.h / 2;
      live.cam = { k, x: wx - mx / k, y: wy - my / k };
    }
    redraw();
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const m = live.model;
    const g = gesture.current;
    ptrs.delete(e.pointerId);
    if (g?.mode === "pinch") {
      if (ptrs.size === 0) gesture.current = undefined;
      return;
    }
    gesture.current = undefined;
    e.currentTarget.style.cursor = "grab";
    if (!m || !g) return;
    if (!g.moved) {
      // A click picks what is under it, again to let go; on the board it clears.
      setSelected(g.target && !sameTarget(g.target, live.selected) ? g.target : undefined);
      return;
    }
    if (g.mode === "part" && g.id) {
      // Where you put a part is where it stays, on this computer, for this project.
      const s = m.byId.get(g.id)!;
      const pins = { ...remembered<Record<string, [number, number]>>(pinKey, {}), [s.id]: [Math.round(s.fx ?? 0), Math.round(s.fy ?? 0)] as [number, number] };
      remember(pinKey, pins);
      setPinned(Object.keys(pins).length);
      m.sim.alphaTarget(0);
    }
  };
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = live.model;
    if (!m || !data) return;
    const w = toWorld(e.clientX, e.clientY);
    const t = hitTest(m, w.x, w.y, live.cam.k);
    if (t?.kind === "file") send({ type: "openFile", path: m.dots[t.i].p, root: data.root });
    else if (t?.kind === "part") flyToPart(t.id);
    else zoomBy(1.6);
  };

  const flyToPart = (id: string) => {
    const s = live.model?.byId.get(id);
    if (!s) return;
    const k = Math.min(4, Math.max(live.cam.k, Math.min(live.w, live.h) / (s.R * 2 + 180)));
    flyTo({ x: s.x ?? 0, y: s.y ?? 0, k });
  };
  const pickFile = (path: string) => {
    const d = live.model?.dotByPath.get(path);
    if (!d) return;
    setSelected({ kind: "file", i: d.i });
    live.pulse = { i: d.i, t: performance.now() };
    flyTo({ x: dotX(d), y: dotY(d), k: Math.max(live.cam.k, 2.2) });
  };
  // Picking a result goes to its file on the board; Open in the bar below opens it.
  const goTo = (h: CodeHitView) => {
    setQ("");
    searchRef.current?.blur();
    pickFile(h.path);
  };
  const tidy = () => {
    remember(pinKey, {});
    live.fitted = undefined;
    setLayoutKey((n) => n + 1);
  };

  useKeys(LAYER.page, (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.key === "Escape") setSelected(undefined);
    else if (e.key === "+" || e.key === "=") zoomBy(1.4);
    else if (e.key === "-") zoomBy(1 / 1.4);
    else if (e.key === "0") fit();
    else return false;
    return true;
  });
  useEffect(() => () => cancelAnimationFrame(live.raf), []); // eslint-disable-line react-hooks/exhaustive-deps

  const project = data ? (data.projects.find((p) => p.root === data.root)?.name ?? data.root.split(/[/\\]/).pop() ?? "project") : "";
  const lit = model ? litFor(model, hover ?? selected) : undefined;
  const selPart = selected?.kind === "part" ? model?.byId.get(selected.id) : undefined;
  const selDot = selected?.kind === "file" ? model?.dots[selected.i] : undefined;
  const hoverInfo = (() => {
    if (!model || !hover) return undefined;
    if (hover.kind === "part") {
      const s = model.byId.get(hover.id);
      if (!s) return undefined;
      return { title: s.label, sub: partPath(s.id) };
    }
    const d = model.dots[hover.i];
    return d ? { title: d.name, sub: d.p.slice(0, -d.name.length - 1) || "top level" } : undefined;
  })();
  const setProject = (r: string) => {
    setRoot(r);
    remember("codeRoot", r);
  };
  const close = () => setSelected(undefined);
  const focusName = selPart ? { title: selPart.label, sub: partPath(selPart.id) } : selDot ? { title: selDot.name, sub: selDot.p } : undefined;

  return (
    <div className="mappage">
      <div className="maptop">
        {data ? <ProjectPicker data={data} name={project} pick={setProject} /> : <div className="projbtn">Reading this project…</div>}
        <div className="mapsearch">
          <div className="codesearch">
            <Search {...I} />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              placeholder="Find a file or function"
              aria-label="Find code"
              role="combobox"
              aria-expanded={shown.length > 0}
              aria-controls="mapfound"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((n) => Math.min(shown.length - 1, n + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((n) => Math.max(0, n - 1));
                } else if (e.key === "Enter" && shown[active]) goTo(shown[active]);
                else if (e.key === "Escape") {
                  setQ("");
                  e.currentTarget.blur();
                }
              }}
            />
            {q ? (
              <button className="icon sm" onClick={() => setQ("")} aria-label="Clear">
                <X {...I} />
              </button>
            ) : (
              <kbd className="findkey">/</kbd>
            )}
          </div>
          {hits && hits.q === q.trim() && (
            <div className="mapfound" id="mapfound" role="listbox">
              {shown.length === 0 && <div className="muted small mapnone">Nothing by that name</div>}
              {shown.map((h, n) => (
                <button key={`${h.path}:${h.start}:${h.name}`} className={`maphit${n === active ? " on" : ""}`} role="option" aria-selected={n === active} onMouseEnter={() => setActive(n)} onClick={() => goTo(h)}>
                  <span className="maphitname ellipsis">{marked(h.name, q.trim())}</span>
                  <span className="maphitfile ellipsis">{h.path.split("/").pop()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mapboard" ref={boardRef}>
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => !gesture.current && setHoverTarget(undefined)} onDoubleClick={onDouble} role="img" aria-label={model ? `Map of ${project}: ${model.parts.length} parts, ${model.dots.length} files. Use Find to reach a file.` : "Map"} />
        {!model && <div className="mapempty muted">{data && !data.building && !data.modules.length ? "No code found in this folder." : data?.building ? "Reading this project for the first time. After this it keeps itself up to date." : "Reading this project…"}</div>}
        <div ref={cardRef} className={`mapcard${hoverInfo ? " on" : ""}`} aria-hidden="true">
          {hoverInfo && (
            <>
              <div className="mapcardtitle ellipsis">{hoverInfo.title}</div>
              <div className="mapcardsub ellipsis">{hoverInfo.sub}</div>
            </>
          )}
        </div>
        <div className="maplegend small">
          {lit ? (
            <>
              <span className="tmkey tmuses" /> {lit.file ? "imports" : "uses"}
              <span className="tmkey tmusedby" /> {lit.file ? "imported by" : "used by"}
            </>
          ) : (
            <span className="muted">Drag to move · scroll to zoom · click for links</span>
          )}
        </div>
        <div className="mapzoom" role="group" aria-label="Zoom">
          <button onClick={() => zoomBy(1.4)} aria-label="Zoom in" data-tip="Zoom in (+)">
            <Plus {...I} />
          </button>
          <button onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" data-tip="Zoom out (−)">
            <Minus {...I} />
          </button>
          <button onClick={fit} aria-label="Show everything" data-tip="Show everything (0)">
            <Maximize2 {...I} />
          </button>
          {pinned > 0 && (
            <button onClick={tidy} aria-label="Tidy up" data-tip="Put every part back in its place">
              <LayoutGrid {...I} />
            </button>
          )}
        </div>

        {focusName && (
          <div className="mapfocus" role="status">
            <span className={`mapfocusdot${selDot ? " file" : ""}`} />
            <span className="mapfocusname ellipsis" data-tip={focusName.sub}>
              {focusName.title}
            </span>
            {selDot && data && (
              <button className="btn small primary" onClick={() => send({ type: "openFile", path: selDot.p, root: data.root })}>
                Open
              </button>
            )}
            <button className="icon sm" onClick={close} aria-label="Clear">
              <X {...I} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
