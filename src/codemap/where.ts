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
