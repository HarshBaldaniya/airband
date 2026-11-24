// The Map's model: where every part and file sits, the camera that shows it all, and what is under
// the pointer. Each part of the project is a small galaxy: its files on a sunflower spiral, the most imported at the
// centre. Parts of one folder pull together into a soft cloud; parts that import each other pull
// gently closer. Parts can be dragged and stay where they are put.
import { forceCollide, forceLink, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from "d3-force";
import type { CodeMapView } from "../../../src/vscode/protocol";

export interface Dot {
  i: number;
  p: string;
  name: string;
  part: Part;
  importers: number;
  dx: number;
  dy: number;
  r: number;
}
export interface Part extends SimulationNodeDatum {
  id: string;
  label: string;
  folder: string;
  files: Dot[];
  count: number;
  R: number;
}
export interface Model {
  parts: Part[];
  byId: Map<string, Part>;
  dots: Dot[];
  dotByPath: Map<string, Dot>;
  folders: { id: string; label: string; parts: Part[] }[];
  edges: { a: Part; b: Part; w: number }[];
  /** Per file: what it imports and what imports it (indices into dots) */
  out: number[][];
  inn: number[][];
  sim: Simulation<Part, undefined>;
}
export interface Cam {
  x: number;
  y: number;
  k: number;
}
export type Target = { kind: "part"; id: string } | { kind: "file"; i: number };
export interface Theme {
  fg: string;
  bg: string;
  uses: string;
  usedby: string;
  focus: string;
}

const SPACING = 7.4;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const groupOf = (id: string) => (id === "." ? "." : id.split("/")[0]);
const folderLabel = (g: string) => (g === "." ? "top level" : g);

/** `shape` is the board's height over its width: a tall phone gets a tall map, a wide screen a wide one. */
export function buildModel(data: CodeMapView, pins: Record<string, [number, number]>, shape = 1): Model {
  const pullX = Math.min(0.26, Math.max(0.03, 0.08 * shape));
  const pullY = Math.min(0.26, Math.max(0.03, 0.08 / shape));
  const groups = new Map<string, string[]>();
  for (const m of data.modules) {
    const g = groupOf(m.id);
    groups.set(g, [...(groups.get(g) ?? []), m.id]);
  }
  // Short names: the folder's group already says where a part lives, so a part shows only its own
  // last folder ("navigation", not "components/custom/shared/navigation"), or two when that clashes.
  const shortName = (id: string, depth: number) => id.split("/").slice(-depth).join("/");
  const parts: Part[] = data.modules.map((m) => {
    const g = groupOf(m.id);
    const siblings = groups.get(g) ?? [];
    let label = m.id === "." ? "top level" : siblings.length <= 1 || m.id === g ? folderLabel(g) : shortName(m.id, 1);
    if (m.id !== g && siblings.length > 1 && siblings.filter((x) => x !== g && shortName(x, 1) === label).length > 1) label = shortName(m.id, 2);
    return { id: m.id, label, folder: g, files: [], count: m.files, R: 0 };
  });
  const byId = new Map(parts.map((s) => [s.id, s]));
  const dots: Dot[] = data.allFiles.map((f, i) => ({ i, p: f.p, name: f.p.split("/").pop() ?? f.p, part: byId.get(f.m)!, importers: f.importers, dx: 0, dy: 0, r: 1.6 + Math.min(1.9, Math.sqrt(f.importers) * 0.42) }));
  for (const d of dots) d.part?.files.push(d);
  for (const s of parts) {
    // The sunflower: most imported first, so the busiest files sit at the heart of the part.
    s.files.sort((a, b) => b.importers - a.importers || a.p.localeCompare(b.p));
    s.files.forEach((d, n) => {
      const rad = SPACING * Math.sqrt(n);
      d.dx = Math.cos(n * GOLDEN) * rad;
      d.dy = Math.sin(n * GOLDEN) * rad;
    });
    s.R = Math.max(16, SPACING * Math.sqrt(Math.max(s.files.length, s.count)) + 10);
  }
  const out: number[][] = dots.map(() => []);
  const inn: number[][] = dots.map(() => []);
  for (const [a, b] of data.links) {
    out[a]?.push(b);
    inn[b]?.push(a);
  }

  const edges = data.edges.map((e) => ({ a: byId.get(e.from)!, b: byId.get(e.to)!, w: e.weight })).filter((e) => e.a && e.b);
  const folderIds = [...groups.keys()];

  // 1. Place the folders: each a circle big enough for its parts, pulled towards the folders it
  //    imports from or is imported by, never overlapping. Folders start on a spiral, so the same
  //    project settles the same way every time.
  type F = SimulationNodeDatum & { id: string; r: number };
  const fnodes: F[] = folderIds.map((g, i) => {
    const area = parts.filter((s) => s.folder === g).reduce((n, s) => n + (s.R + 10) ** 2, 0);
    return { id: g, r: Math.sqrt(area) * 1.4 + 30, x: Math.cos(i * GOLDEN) * 40 * Math.sqrt(i + 1), y: Math.sin(i * GOLDEN) * 40 * Math.sqrt(i + 1) };
  });
  const fw = new Map<string, number>();
  for (const e of edges) {
    if (e.a.folder === e.b.folder) continue;
    const key = [e.a.folder, e.b.folder].sort().join("\u0000");
    fw.set(key, (fw.get(key) ?? 0) + e.w);
  }
  const maxW = Math.max(1, ...fw.values());
  const flinks = [...fw.entries()].map(([key, w]) => {
    const [source, target] = key.split("\u0000");
    return { source, target, w };
  });
  const fsim = forceSimulation<F>(fnodes)
    .force("link", forceLink<F, { source: string | F; target: string | F; w: number }>(flinks).id((n) => n.id).distance(0).strength((l) => 0.04 + 0.2 * Math.sqrt(l.w / maxW)))
    .force("collide", forceCollide<F>((n) => n.r + 110).iterations(4))
    .force("x", forceX<F>(0).strength(pullX))
    .force("y", forceY<F>(0).strength(pullY))
    .stop();
  for (let i = 0; i < 400; i++) fsim.tick();
  const centre = new Map(fnodes.map((f) => [f.id, { x: f.x ?? 0, y: f.y ?? 0 }]));

  // 2. Settle each folder's parts around its centre, biggest in the middle. The same forces keep
  //    running while a part is dragged, so its neighbours make room and the folder stays together.
  const order = new Map<string, number>();
  for (const g of folderIds) parts.filter((x) => x.folder === g).sort((a, b) => b.R - a.R).forEach((x, n) => order.set(x.id, n));
  for (const part of parts) {
    const c = centre.get(part.folder)!;
    const n = order.get(part.id) ?? 0;
    const pin = pins[part.id];
    part.x = pin ? pin[0] : c.x + Math.cos(n * GOLDEN) * 40 * Math.sqrt(n);
    part.y = pin ? pin[1] : c.y + Math.sin(n * GOLDEN) * 40 * Math.sqrt(n);
    if (pin) {
      part.fx = pin[0];
      part.fy = pin[1];
    }
  }
  const sim = forceSimulation<Part>(parts)
    .force("x", forceX<Part>((n) => centre.get(n.folder)!.x).strength(0.06))
    .force("y", forceY<Part>((n) => centre.get(n.folder)!.y).strength(0.06))
    // Room between parts for their names and for the wires to pass.
    .force("collide", forceCollide<Part>((n) => n.R + 30).iterations(4))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();
  sim.alpha(0);

  const folders = folderIds.map((g) => ({ id: g, label: folderLabel(g), parts: parts.filter((s) => s.folder === g) }));
  return { parts, byId, dots, dotByPath: new Map(dots.map((d) => [d.p, d])), folders, edges, out, inn, sim };
}

/** Each folder's middle and the edge of its cloud: where its joints sit. */
export function folderGeo(m: Model): Map<string, { x: number; y: number; r: number }> {
  const out = new Map<string, { x: number; y: number; r: number }>();
  for (const f of m.folders) {
    if (!f.parts.length) continue;
    const x = f.parts.reduce((n, p) => n + (p.x ?? 0), 0) / f.parts.length;
    const y = f.parts.reduce((n, p) => n + (p.y ?? 0), 0) / f.parts.length;
    const r = Math.max(...f.parts.map((p) => Math.hypot((p.x ?? 0) - x, (p.y ?? 0) - y) + p.R)) + 20;
    out.set(f.id, { x, y, r });
  }
  return out;
}

export const dotX = (d: Dot) => (d.part.x ?? 0) + d.dx;
export const dotY = (d: Dot) => (d.part.y ?? 0) + d.dy;

function bounds(m: Model): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of m.parts) {
    x0 = Math.min(x0, (s.x ?? 0) - s.R);
    y0 = Math.min(y0, (s.y ?? 0) - s.R);
    x1 = Math.max(x1, (s.x ?? 0) + s.R);
    y1 = Math.max(y1, (s.y ?? 0) + s.R);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
}

/** The camera that shows the whole project with room around it. */
export function fitCam(m: Model, w: number, h: number, top = 0): Cam {
  const b = bounds(m);
  // Room for the labels under the parts and above the folders, and for whatever floats on top.
  const pad = 44;
  const k = Math.min(2, Math.max(0.08, Math.min((w - pad * 2) / Math.max(1, b.x1 - b.x0), (h - top - pad * 2) / Math.max(1, b.y1 - b.y0 + 30))));
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 - top / 2 / k, k };
}

/** What is under a point, in world units: a file first (they are on top), then a part. */
export function hitTest(m: Model, x: number, y: number, k: number): Target | undefined {
  let best: Dot | undefined;
  let bestD = Infinity;
  const reach = 7 / k;
  for (const d of m.dots) {
    const dd = Math.hypot(dotX(d) - x, dotY(d) - y);
    if (dd <= Math.max(d.r + 1, reach) && dd < bestD) {
      best = d;
      bestD = dd;
    }
  }
  // Far out, the dots are too small to aim at: the part is what is meant.
  if (best && k >= 0.9) return { kind: "file", i: best.i };
  let sys: Part | undefined;
  let sysD = Infinity;
  for (const s of m.parts) {
    const dd = Math.hypot((s.x ?? 0) - x, (s.y ?? 0) - y);
    if (dd <= s.R + 8 / k && dd < sysD) {
      sys = s;
      sysD = dd;
    }
  }
  return sys ? { kind: "part", id: sys.id } : undefined;
}

/** What lights up for the part or file in focus. */
export interface Lit {
  part?: Part;
  file?: Dot;
  usesParts: Map<Part, number>;
  usedByParts: Map<Part, number>;
  usesFiles: Set<number>;
  usedByFiles: Set<number>;
}
export function litFor(m: Model, t: Target | undefined): Lit | undefined {
  if (!t) return undefined;
  const lit: Lit = { usesParts: new Map(), usedByParts: new Map(), usesFiles: new Set(), usedByFiles: new Set() };
  if (t.kind === "part") {
    const s = m.byId.get(t.id);
    if (!s) return undefined;
    lit.part = s;
    for (const e of m.edges) {
      if (e.a === s && e.b !== s) lit.usesParts.set(e.b, e.w);
      if (e.b === s && e.a !== s) lit.usedByParts.set(e.a, e.w);
    }
  } else {
    const d = m.dots[t.i];
    if (!d) return undefined;
    lit.file = d;
    for (const j of m.out[d.i] ?? []) lit.usesFiles.add(j);
    for (const j of m.inn[d.i] ?? []) lit.usedByFiles.add(j);
  }
  return lit;
}

export const sameTarget = (a?: Target, b?: Target) => !!a && !!b && a.kind === b.kind && (a.kind === "part" ? a.id === (b as { id: string }).id : a.i === (b as { i: number }).i);
