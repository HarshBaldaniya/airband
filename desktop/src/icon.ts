// The app icon and menu-bar icon, drawn in code from the default companion design ("headset"): a
// few shapes with soft edges, written as PNG. No image files or image libraries. Shapes use the
// design's own drawing units (200 × 220).
import * as zlib from "node:zlib";

type Rgba = [number, number, number, number];
type Dist = (x: number, y: number) => number;
interface Layer {
  d: Dist;
  color?: Rgba;
  /** Cut a hole: what is under it becomes see-through. */
  clear?: boolean;
}

const hex = (h: string, a = 1): Rgba => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];

// Distances to the edge of a shape: below 0 inside, above 0 outside.
const roundRect = (x0: number, y0: number, x1: number, y1: number, r: number): Dist => (x, y) => {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const qx = Math.abs(x - cx) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - cy) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const ellipse = (cx: number, cy: number, rx: number, ry: number): Dist => (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
const circle = (cx: number, cy: number, r: number): Dist => (x, y) => Math.hypot(x - cx, y - cy) - r;
const segment = (ax: number, ay: number, bx: number, by: number, w: number): Dist => (x, y) => {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t) - w / 2;
};
/** A band along an ellipse, only where `keep` says (the top of the headset, the curve of a smile). */
const ring = (cx: number, cy: number, rx: number, ry: number, w: number, keep: (x: number, y: number) => boolean): Dist => (x, y) => (keep(x, y) ? Math.abs((Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry)) - w / 2 : 1e9);

/** The headset figure, front on, in its drawing units. */
function figureLayers(light: string): Layer[] {
  const dark = hex("#2a2a30");
  return [
    { d: segment(100, 42, 100, 18, 7), color: dark },
    { d: circle(100, 14, 10), color: hex(light) },
    { d: ellipse(34, 142, 10, 15), color: hex("#c9653d") },
    { d: ellipse(166, 142, 10, 15), color: hex("#c9653d") },
    { d: roundRect(32, 40, 168, 186, 60), color: hex("#E07A4F") },
    { d: ellipse(100, 154, 42, 26), color: hex("#ee9a74") },
    { d: ring(100, 96, 56, 60, 9, (_x, y) => y <= 96), color: dark },
    { d: roundRect(24, 82, 46, 118, 10), color: dark },
    { d: roundRect(154, 82, 176, 118, 10), color: dark },
    { d: ellipse(80, 104, 14, 16), color: hex("#ffffff") },
    { d: ellipse(120, 104, 14, 16), color: hex("#ffffff") },
    { d: circle(82, 106, 7.5), color: hex("#141416") },
    { d: circle(122, 106, 7.5), color: hex("#141416") },
    { d: circle(85, 102, 2.5), color: hex("#ffffff") },
    { d: circle(125, 102, 2.5), color: hex("#ffffff") },
    { d: ellipse(62, 128, 9, 5), color: hex("#f6b496") },
    { d: ellipse(138, 128, 9, 5), color: hex("#f6b496") },
    { d: ring(100, 122, 10, 10, 3.6, (_x, y) => y >= 126), color: hex("#141416") },
  ];
}

/** A band along the edge of a shape: its outline, `w` wide. */
const outline = (d: Dist, w: number): Dist => (x, y) => Math.abs(d(x, y)) - w / 2;

/** The menu-bar glyph, drawn like the menu bar's own icons: solid shapes with cut-outs, no thin
 *  lines. A solid head with two eyes cut out, a bold headset over it and a short antenna.
 *  Black on clear: macOS tints it for light and dark menu bars. */
function trayLayers(): Layer[] {
  const k = hex("#000000");
  return [
    { d: segment(100, 44, 100, 20, 16), color: k },
    { d: circle(100, 16, 15), color: k },
    { d: ring(100, 122, 78, 76, 16, (_x, y) => y <= 118), color: k },
    { d: roundRect(10, 104, 42, 160, 14), color: k },
    { d: roundRect(158, 104, 190, 160, 14), color: k },
    { d: roundRect(50, 66, 150, 196, 46), color: k },
    { d: ellipse(81, 124, 12, 16), clear: true },
    { d: ellipse(119, 124, 12, 16), clear: true },
  ];
}

/** Draws layers into a size × size square, the 200 × 220 drawing scaled to `fit` of it and centred. */
function draw(size: number, layers: Layer[], fit: number, background?: Layer[]): Buffer {
  const scale = (size * fit) / 220;
  const ox = (size - 200 * scale) / 2;
  const oy = (size - 220 * scale) / 2;
  const px = Buffer.alloc(size * size * 4);
  const SS = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;
          let cr = 0;
          let cg = 0;
          let cb = 0;
          let ca = 0;
          const paint = (l: Layer, ux: number, uy: number, unit: number) => {
            const cov = Math.max(0, Math.min(1, 0.5 - l.d(ux, uy) * unit));
            if (!cov) return;
            if (l.clear) {
              ca *= 1 - cov;
              return;
            }
            const [lr, lg, lb, la] = l.color!;
            const al = la * cov;
            const out = al + ca * (1 - al);
            if (out > 0) {
              cr = (lr * al + cr * ca * (1 - al)) / out;
              cg = (lg * al + cg * ca * (1 - al)) / out;
              cb = (lb * al + cb * ca * (1 - al)) / out;
            }
            ca = out;
          };
          for (const l of background ?? []) paint(l, fx, fy, 1);
          for (const l of layers) paint(l, (fx - ox) / scale, (fy - oy) / scale, scale);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      px[i + 3] = Math.round((a / n) * 255);
      if (a > 0) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
      }
    }
  }
  return encodePng(size, size, px);
}

/** The app's icon: the figure on a dark tile, the way macOS icons sit in their square. */
export function appIconPng(size = 1024): Buffer {
  const m = size * 0.1;
  const tile: Layer[] = [{ d: roundRect(m, m, size - m, size - m, size * 0.18), color: hex("#1d1d21") }];
  return draw(size, figureLayers("#3fb57d"), 0.62, tile);
}

/** The menu-bar icon: 18 points tall, drawn at 1× and 2× so it is sharp on every screen. */
export function trayIconPng(size = 36): Buffer {
  return draw(size, trayLayers(), 1);
}

/** A small colour figure for places that show colour (Windows' tray, notifications). */
/** The phone's Home Screen icon: full-bleed (the phone rounds the corners itself). */
export function phoneIconPng(size = 512): Buffer {
  const tile: Layer[] = [{ d: roundRect(0, 0, size, size, 0), color: hex("#1d1d21") }];
  return draw(size, figureLayers("#3fb57d"), 0.66, tile);
}

export function colorIconPng(size = 64, light = "#3fb57d"): Buffer {
  return draw(size, figureLayers(light), 0.95);
}

// ---- PNG ----

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(w: number, h: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
