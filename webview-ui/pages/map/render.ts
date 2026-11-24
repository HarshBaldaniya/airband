// Drawing the Map on a canvas, so a project of thousands of files still pans and zooms smoothly.
import { dotX, dotY, folderGeo, type Cam, type Dot, type Lit, type Model, type Part, type Target, type Theme } from "./model";

interface DrawState {
  w: number;
  h: number;
  dpr: number;
  cam: Cam;
  theme: Theme;
  lit?: Lit;
  /** 0..1: how far the board has dimmed towards the focus */
  fade: number;
  hover?: Target;
  selected?: Target;
  pulse?: { i: number; t: number };
  now: number;
  /** No motion: the person asked their system for less */
  still?: boolean;
  /** Files a search found */
  found?: Set<number>;
}

export function draw(ctx: CanvasRenderingContext2D, m: Model, s: DrawState): void {
  const { w, h, dpr, cam, theme, lit, fade } = s;
  const k = cam.k;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  // The board: a dot grid that moves with the camera, like the Tower.
  let gap = 24 * k;
  while (gap < 12) gap *= 2;
  const ox = (w / 2 - cam.x * k) % gap;
  const oy = (h / 2 - cam.y * k) % gap;
  ctx.fillStyle = theme.fg;
  ctx.globalAlpha = 0.17;
  for (let x = ox; x < w; x += gap) for (let y = oy; y < h; y += gap) ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);

  const sx = (x: number) => w / 2 + (x - cam.x) * k;
  const sy = (y: number) => h / 2 + (y - cam.y) * k;
  const dim = (on: boolean) => (on ? 1 : 1 - 0.78 * fade);
  const partOn = (p: Part) => !lit || (lit.part ? p === lit.part || lit.usesParts.has(p) || lit.usedByParts.has(p) : p === lit.file?.part);

  // Folder clouds: one fill of all its parts' circles, so overlaps don't darken.
  for (const f of m.folders) {
    if (f.parts.length < 2) continue;
    ctx.beginPath();
    for (const p of f.parts) {
      ctx.moveTo(sx(p.x ?? 0) + (p.R + 20) * k, sy(p.y ?? 0));
      ctx.arc(sx(p.x ?? 0), sy(p.y ?? 0), (p.R + 20) * k, 0, Math.PI * 2);
    }
    ctx.fillStyle = theme.fg;
    ctx.globalAlpha = 0.045 * dim(f.parts.some(partOn));
    ctx.fill();
  }

  // Wires, bundled: every wire between two folders is one smooth curve pulled towards the same two
  // points on the folders' edges, so wires going the same way run together and part again near their
  // ends, with no knots or corners. Wires inside a folder go straight across. In focus, the wires of
  // the part or file light up and flow the way the import goes: blue to what it uses, orange from
  // what uses it.
  const geo = folderGeo(m);
  const gate = (a: string, b: string) => {
    const A = geo.get(a)!;
    const B = geo.get(b)!;
    const l = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    return { x: A.x + ((B.x - A.x) / l) * A.r, y: A.y + ((B.y - A.y) / l) * A.r };
  };
  // A point on a part's ring, facing somewhere.
  const rim = (p: Part, tx: number, ty: number) => {
    const l = Math.hypot(tx - (p.x ?? 0), ty - (p.y ?? 0)) || 1;
    return { x: (p.x ?? 0) + ((tx - (p.x ?? 0)) / l) * p.R, y: (p.y ?? 0) + ((ty - (p.y ?? 0)) / l) * p.R };
  };
  /** One wire, in world points. `off` places it across its bundle, in screen pixels, so wires that
   *  travel together lie side by side like a ribbon instead of on top of each other. */
  const route = (a: { x: number; y: number }, fa: string, b: { x: number; y: number }, fb: string, off = 0) => {
    ctx.beginPath();
    ctx.moveTo(sx(a.x), sy(a.y));
    if (fa === fb) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      const bend = l * 0.12;
      ctx.quadraticCurveTo(sx((a.x + b.x) / 2 - (dy / l) * bend), sy((a.y + b.y) / 2 + (dx / l) * bend), sx(b.x), sy(b.y));
      return;
    }
    const g1 = gate(fa, fb);
    const g2 = gate(fb, fa);
    const l = Math.hypot(g2.x - g1.x, g2.y - g1.y) || 1;
    const nx = (-(g2.y - g1.y) / l) * off;
    const ny = ((g2.x - g1.x) / l) * off;
    ctx.bezierCurveTo(sx(g1.x) + nx, sy(g1.y) + ny, sx(g2.x) + nx, sy(g2.y) + ny, sx(b.x), sy(b.y));
  };
  /** Each wire's place in its bundle: wires between the same two folders, ordered across the bundle by
   *  where they start, so neighbours stay neighbours and the ribbon never twists. */
  const ribbon = <T>(items: T[], ends: (t: T) => readonly [{ x: number; y: number }, string, { x: number; y: number }, string]) => {
    const groups = new Map<string, { t: T; key: number }[]>();
    for (const t of items) {
      const [a, fa, b, fb] = ends(t);
      if (fa === fb) continue;
      // One direction per pair of folders, so wires both ways share one ribbon.
      const flip = fa > fb;
      const [p, f1, f2] = flip ? [b, fb, fa] : [a, fa, fb];
      const g1 = gate(f1, f2);
      const g2 = gate(f2, f1);
      const l = Math.hypot(g2.x - g1.x, g2.y - g1.y) || 1;
      const key = (p.x - g1.x) * (-(g2.y - g1.y) / l) + (p.y - g1.y) * ((g2.x - g1.x) / l);
      const id = `${f1}\u0000${f2}`;
      groups.set(id, [...(groups.get(id) ?? []), { t, key: flip ? -key : key }]);
    }
    const out = new Map<T, number>();
    for (const g of groups.values()) {
      g.sort((x, y) => x.key - y.key);
      const gap = Math.min(2.6, 30 / g.length);
      g.forEach((x, n) => out.set(x.t, (n - (g.length - 1) / 2) * gap));
    }
    return out;
  };
  const ends = (a: Part, b: Part) => {
    // Each end leaves its ring facing where the wire is headed first.
    const ta = a.folder === b.folder ? { x: b.x ?? 0, y: b.y ?? 0 } : gate(a.folder, b.folder);
    const tb = a.folder === b.folder ? { x: a.x ?? 0, y: a.y ?? 0 } : gate(b.folder, a.folder);
    return [rim(a, ta.x, ta.y), rim(b, tb.x, tb.y)] as const;
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // At rest: every wire, faint, so the bundles show by themselves.
  const rest = 1 - 0.8 * fade;
  ctx.strokeStyle = theme.fg;
  // The more wires, the fainter each one at rest, so a big project reads as a few soft bundles.
  const quiet = Math.min(1, Math.sqrt(120 / Math.max(1, m.edges.length)));
  const edgeEnds = new Map(m.edges.map((e) => [e, ends(e.a, e.b)] as const));
  const place = ribbon(m.edges, (e) => {
    const [a, b] = edgeEnds.get(e)!;
    return [a, e.a.folder, b, e.b.folder] as const;
  });
  for (const e of m.edges) {
    const [a, b] = edgeEnds.get(e)!;
    route(a, e.a.folder, b, e.b.folder, place.get(e) ?? 0);
    ctx.globalAlpha = (e.a.folder === e.b.folder ? 0.07 : 0.1) * quiet * rest;
    ctx.lineWidth = Math.min(2.6, 0.8 + Math.log2(1 + e.w) * 0.4);
    ctx.stroke();
  }

  // In focus: each wire whole, a soft line with light flowing along it.
  const flow = (color: string) => {
    ctx.strokeStyle = color;
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.setLineDash([5, 9]);
    ctx.lineDashOffset = s.still ? 0 : -((s.now / 45) % 14);
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (lit?.part) {
    const P = lit.part;
    for (const e of m.edges) {
      if (e.a !== P && e.b !== P) continue;
      const [a, b] = edgeEnds.get(e)!;
      route(a, e.a.folder, b, e.b.folder, place.get(e) ?? 0);
      flow(e.a === P ? theme.uses : theme.usedby);
    }
  } else if (lit?.file) {
    const f = lit.file;
    const wires = [
      ...[...lit.usesFiles].map((j) => ({ a: f, b: m.dots[j], color: theme.uses })),
      ...[...lit.usedByFiles].map((j) => ({ a: m.dots[j], b: f, color: theme.usedby })),
    ].filter((x) => x.a && x.b);
    const at = (d: Dot) => ({ x: dotX(d), y: dotY(d) });
    const filePlace = ribbon(wires, (x) => [at(x.a), x.a.part.folder, at(x.b), x.b.part.folder] as const);
    for (const x of wires) {
      route(at(x.a), x.a.part.folder, at(x.b), x.b.part.folder, filePlace.get(x) ?? 0);
      flow(x.color);
    }
  }

  // Parts: a ring around each galaxy.
  for (const p of m.parts) {
    const x = sx(p.x ?? 0);
    const y = sy(p.y ?? 0);
    const r = p.R * k;
    if (x + r < -40 || x - r > w + 40 || y + r < -40 || y - r > h + 40) continue;
    const isSel = s.selected?.kind === "part" && s.selected.id === p.id;
    const isHover = s.hover?.kind === "part" && s.hover.id === p.id;
    const tint = lit?.usesParts.has(p) ? theme.uses : lit?.usedByParts.has(p) ? theme.usedby : undefined;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.globalAlpha = (tint ? 0.12 : 0.045) * dim(partOn(p));
    ctx.fillStyle = tint ?? theme.fg;
    ctx.fill();
    ctx.globalAlpha = (isSel || isHover ? 0.95 : tint ? 0.85 : 0.2) * dim(partOn(p));
    ctx.strokeStyle = isSel ? theme.focus : tint ?? theme.fg;
    ctx.lineWidth = isSel ? 2 : isHover || tint ? 1.5 : 1;
    if (isSel) {
      ctx.shadowColor = theme.focus;
      ctx.shadowBlur = 14;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Files: the stars. Brighter when more of the code imports them.
  for (const d of m.dots) {
    const x = sx(dotX(d));
    const y = sy(dotY(d));
    if (x < -10 || x > w + 10 || y < -10 || y > h + 10) continue;
    const r = Math.max(0.7, d.r * k);
    let color = theme.fg;
    let on = partOn(d.part);
    if (s.found && !lit) {
      // A search glows where its files are; everything else steps back.
      const hit = s.found.has(d.i);
      ctx.beginPath();
      ctx.arc(x, y, hit ? Math.max(r, 3) : r, 0, Math.PI * 2);
      ctx.fillStyle = hit ? theme.focus : theme.fg;
      ctx.globalAlpha = hit ? 1 : 0.12;
      ctx.fill();
      if (hit) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(r, 3) + 4, 0, Math.PI * 2);
        ctx.strokeStyle = theme.focus;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      continue;
    }
    if (lit?.file) {
      on = d === lit.file || lit.usesFiles.has(d.i) || lit.usedByFiles.has(d.i);
      if (d === lit.file) color = theme.focus;
      else if (lit.usesFiles.has(d.i)) color = theme.uses;
      else if (lit.usedByFiles.has(d.i)) color = theme.usedby;
    }
    ctx.beginPath();
    ctx.arc(x, y, color === theme.fg ? r : Math.max(r, 2.6), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = (color === theme.fg ? 0.32 + 0.6 * Math.min(1, Math.sqrt(d.importers / 16)) : 1) * (lit?.file ? (on ? 1 : 1 - 0.85 * fade) : dim(on));
    ctx.fill();
  }

  // A file found by search pulses three times.
  if (s.pulse) {
    const d = m.dots[s.pulse.i];
    const t = (s.now - s.pulse.t) / 1000;
    if (d && t < 3) {
      const ph = t % 1;
      ctx.beginPath();
      ctx.arc(sx(dotX(d)), sy(dotY(d)), 4 + ph * 22, 0, Math.PI * 2);
      ctx.strokeStyle = theme.focus;
      ctx.globalAlpha = 1 - ph;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Labels, in screen pixels: folders, then parts, then files when zoomed in. None overlap.
  const taken: [number, number, number, number][] = [];
  const free = (x0: number, y0: number, x1: number, y1: number) => {
    if (x1 < 0 || x0 > w || y1 < 0 || y0 > h) return false;
    for (const t of taken) if (x0 < t[2] && x1 > t[0] && y0 < t[3] && y1 > t[1]) return false;
    taken.push([x0, y0, x1, y1]);
    return true;
  };
  const label = (text: string, x: number, y: number, font: string, alpha: number, color = theme.fg, align: CanvasTextAlign = "center", force = false) => {
    ctx.font = font;
    const tw = ctx.measureText(text).width;
    const x0 = align === "center" ? x - tw / 2 : x;
    if (!free(x0 - 3, y - 9, x0 + tw + 3, y + 7) && !force) return;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.globalAlpha = alpha;
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = theme.bg;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  const UI = "system-ui, -apple-system, 'Segoe UI', sans-serif";

  // The focused file's name always shows, then the rest where they fit.
  const focusDot = s.hover?.kind === "file" ? m.dots[s.hover.i] : s.selected?.kind === "file" ? m.dots[s.selected.i] : undefined;
  if (focusDot) label(focusDot.name, sx(dotX(focusDot)) + 8, sy(dotY(focusDot)), `600 12px ${UI}`, 1, theme.fg, "left", true);
  const bySize = [...m.parts].sort((a, b) => b.R - a.R);
  for (const p of bySize) {
    const on = partOn(p);
    const isSel = (s.selected?.kind === "part" && s.selected.id === p.id) || (s.hover?.kind === "part" && s.hover.id === p.id);
    label(p.label, sx(p.x ?? 0), sy(p.y ?? 0) + p.R * k + 13, `${isSel ? 700 : 600} 12px ${UI}`, dim(on), theme.fg, "center", isSel);
  }
  for (const f of m.folders) {
    if (f.parts.length < 2) continue;
    let top = Infinity;
    let cx = 0;
    for (const p of f.parts) {
      top = Math.min(top, (p.y ?? 0) - p.R - 20);
      cx += p.x ?? 0;
    }
    label(f.label.toUpperCase(), sx(cx / f.parts.length), sy(top) - 9, `700 11px ${UI}`, 0.6 * dim(f.parts.some(partOn)), theme.fg, "center", true);
  }
  if (k >= 1.8) {
    const files = [...m.dots].sort((a, b) => b.importers - a.importers);
    let shown = 0;
    for (const d of files) {
      if (shown > 220) break;
      const on = lit?.file ? d === lit.file || lit.usesFiles.has(d.i) || lit.usedByFiles.has(d.i) : partOn(d.part);
      const before = taken.length;
      label(d.name, sx(dotX(d)) + d.r * k + 5, sy(dotY(d)), `11px ${UI}`, 0.8 * (lit?.file ? (on ? 1 : 0.15) : dim(on)), theme.fg, "left");
      if (taken.length > before) shown++;
    }
  }
  ctx.globalAlpha = 1;
}
