// Where a folder's map is kept. On its own, with no parser behind it, so the hook (which runs on
// every message) can say "map ready" without loading the code parser.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { airbandFile } from "../core/paths";

export function folderId(root: string): string {
  let real = root;
  try {
    real = fs.realpathSync(root);
  } catch {
    // A folder that is gone still has an id.
  }
  const hash = crypto.createHash("sha1").update(real).digest("hex").slice(0, 10);
  return `${path.basename(real).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40)}-${hash}`;
}

export function storeDir(root: string): string {
  return airbandFile("codemap", folderId(root));
}

export interface MappedProject {
  name: string;
  root: string;
  files: number;
  builtAt: number;
}

/** Every folder Airband has mapped on this computer, newest first. */
export function mappedProjects(): MappedProject[] {
  const out: MappedProject[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(airbandFile("codemap"));
  } catch {
    return out;
  }
  for (const d of dirs) {
    try {
      const meta = JSON.parse(fs.readFileSync(airbandFile("codemap", d, "meta.json"), "utf8")) as { root?: string; files?: number; builtAt?: number };
      if (meta.root && fs.existsSync(meta.root)) out.push({ name: path.basename(meta.root), root: meta.root, files: meta.files ?? 0, builtAt: meta.builtAt ?? 0 });
    } catch {
      // Not a map, or half written.
    }
  }
  return out.sort((a, b) => b.builtAt - a.builtAt);
}

/**
 * Another project by its folder's name ("my-api", any case) or path. Only folders already mapped
 * are found by name, so a guess never maps a stranger's folder.
 */
export function findProject(name: string, from = process.cwd()): MappedProject | string {
  const q = name.trim();
  const all = mappedProjects();
  const asPath = path.resolve(from, q.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  const byPath = all.find((p) => p.root === asPath);
  if (byPath) return byPath;
  const lower = q.toLowerCase();
  const exact = all.filter((p) => p.name.toLowerCase() === lower);
  const hits = exact.length ? exact : all.filter((p) => p.name.toLowerCase().includes(lower));
  if (hits.length === 1 || (hits.length > 1 && exact.length === 1)) return hits[0];
  if (hits.length > 1) return `Several mapped projects match "${q}": ${hits.map((p) => p.root).join(", ")}. Name one by its path.`;
  if (fs.existsSync(asPath) && fs.statSync(asPath).isDirectory()) return { name: path.basename(asPath), root: asPath, files: 0, builtAt: 0 };
  const names = all.map((p) => p.name);
  return `No mapped project called "${q}".${names.length ? ` Mapped here: ${names.slice(0, 12).join(", ")}.` : ""} Map one first: airband map <folder>.`;
}
