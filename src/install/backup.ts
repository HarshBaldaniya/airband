// Backing up what only lives on this computer: the session logs (every chat's asks and outcomes), the
// person's own Library commands, and which chats are linked. The code map is not backed up: it is
// rebuilt from the code in seconds. Copies only what changed, never deletes from the backup.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { airbandHome } from "../core/paths";
import { MiB } from "../core/units";

/** What is worth keeping: personal, and impossible to rebuild. */
const ITEMS = ["flightlogs", "library", "connections.json", "deliveries.jsonl"];

const machine = () => os.hostname().replace(/\.local$/, "").replace(/[^A-Za-z0-9_-]/g, "_") || "this-computer";

export function backupDirFor(folder: string): string {
  return path.join(folder, "airband-backup", machine());
}

/** Every plain file under `src`. Links are not followed (a backup folder others can write to could
 *  hold one pointing anywhere, or a loop), and it goes at most 8 folders deep. */
function walk(src: string, fn: (rel: string, full: string, st: fs.Stats) => void, rel = "", depth = 0) {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(src);
  } catch {
    return;
  }
  if (st.isFile()) return fn(rel, src, st);
  if (!st.isDirectory() || depth > 8) return;
  for (const name of fs.readdirSync(src)) walk(path.join(src, name), fn, rel ? path.join(rel, name) : name, depth + 1);
}

/** Copies every new or changed file to `<folder>/airband-backup/<this computer>/`. */
export function backUp(folder: string): { copied: number; files: number; to: string } {
  const to = backupDirFor(folder);
  let copied = 0;
  let files = 0;
  for (const item of ITEMS) {
    walk(path.join(airbandHome(), item), (rel, full, st) => {
      files++;
      const dest = path.join(to, item, rel);
      try {
        const d = fs.statSync(dest);
        if (d.size === st.size && Math.abs(d.mtimeMs - st.mtimeMs) < 1000) return;
      } catch {
        // Not backed up yet.
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(full, dest);
      fs.utimesSync(dest, st.atime, st.mtime);
      copied++;
    });
  }
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, "README.txt"), `Airband's session logs from ${machine()}, last backed up ${new Date().toISOString()}.\nRestore with "Airband: Restore session logs" or: node ~/.airband/airband.js restore "${folder}"\n`);
  return { copied, files, to };
}

/**
 * What a restore brings back. Not connections.json: which chats are linked decides what they hear
 * from each other, and a backup folder can be shared (a synced drive, a team folder), so links are
 * never taken from it. Each file must also look like what Airband itself writes there.
 */
const RESTORED: Record<string, (rel: string, text: string) => boolean> = {
  flightlogs: (rel, text) => {
    const m = /^([A-Za-z0-9_-]{1,128})\.(json|jsonl)$/.exec(rel);
    if (!m) return false;
    if (m[2] === "jsonl") return jsonLinesOfObjects(text);
    const head = parseObject(text);
    return !!head && head.id === m[1] && typeof head.updatedAt === "number";
  },
  library: (rel) => /\.md$/i.test(rel) && rel.split(path.sep).length <= 2,
  "deliveries.jsonl": (_rel, text) => jsonLinesOfObjects(text),
};
/** The largest file a restore copies in. */
const RESTORE_FILE_MAX = 64 * MiB;

function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const jsonLinesOfObjects = (text: string) => text.split("\n").every((l) => !l.trim() || !!parseObject(l));

/**
 * Brings back what this computer is missing from every computer's backup in the folder: a file that
 * isn't here, or is shorter here (session logs only ever grow), is copied in. Nothing is overwritten
 * with something older or shorter, and a file that doesn't look like Airband's own is left out.
 */
export function restore(folder: string): { restored: number; refused: number; from: string[] } {
  const root = path.join(folder, "airband-backup");
  let machines: string[] = [];
  try {
    machines = fs.readdirSync(root).filter((m) => fs.lstatSync(path.join(root, m)).isDirectory());
  } catch {
    return { restored: 0, refused: 0, from: [] };
  }
  let restored = 0;
  let refused = 0;
  for (const m of machines) {
    for (const [item, fits] of Object.entries(RESTORED)) {
      walk(path.join(root, m, item), (rel, full, st) => {
        const dest = path.join(airbandHome(), item, rel);
        try {
          const d = fs.statSync(dest);
          if (d.size >= st.size) return;
        } catch {
          // Missing here: restore it.
        }
        const text = st.size <= RESTORE_FILE_MAX ? fs.readFileSync(full, "utf8") : undefined;
        if (text === undefined || !fits(rel, text)) return void refused++;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, text);
        restored++;
      });
    }
  }
  return { restored, refused, from: machines };
}
