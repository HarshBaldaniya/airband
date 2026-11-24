// The parser: tree-sitter compiled to WASM (Microsoft's @vscode/tree-sitter-wasm build, MIT), the
// same in the extension, the MCP server and the tests. No native build, no AI.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as https from "node:https";
import * as path from "node:path";
import { airbandFile, writeFileAtomic } from "../core/paths";
// The package is UMD; its default export is the web-tree-sitter namespace.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TreeSitter = require("@vscode/tree-sitter-wasm") as typeof import("@vscode/tree-sitter-wasm");

export type LangId = "typescript" | "tsx" | "javascript" | "python" | "go" | "rust" | "java" | "csharp" | "ruby" | "php";
export type Tree = import("@vscode/tree-sitter-wasm").Tree;
export type SyntaxNode = import("@vscode/tree-sitter-wasm").Node;
export type Language = import("@vscode/tree-sitter-wasm").Language;
export type Query = import("@vscode/tree-sitter-wasm").Query;

const BY_EXT: Record<string, LangId> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".rb": "ruby",
  ".rake": "ruby",
  ".php": "php",
};

const GRAMMAR: Record<LangId, string> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  java: "tree-sitter-java.wasm",
  csharp: "tree-sitter-c-sharp.wasm",
  ruby: "tree-sitter-ruby.wasm",
  php: "tree-sitter-php.wasm",
};

/** The ones the npm package carries; the rest are fetched once, when a project first needs them. */
export const BUNDLED_GRAMMARS = ["tree-sitter.wasm", "tree-sitter-typescript.wasm", "tree-sitter-tsx.wasm", "tree-sitter-javascript.wasm", "tree-sitter-python.wasm"];

/** Fetches a parser file. Swappable in tests. */
export type GrammarFetcher = (url: string) => Promise<Buffer>;
let fetchGrammar: GrammarFetcher = httpsGet;

export function setGrammarFetcher(f: GrammarFetcher | undefined): void {
  fetchGrammar = f ?? httpsGet;
}

/** Where a fetched parser can come from: the same npm package the build used, through two public
 *  npm mirrors. Whatever arrives must match the fingerprint written in at build time. */
function grammarUrls(file: string): string[] {
  const pkg = __AIRBAND_GRAMMARS__.pkg;
  return [`https://cdn.jsdelivr.net/npm/${pkg}/wasm/${file}`, `https://unpkg.com/${pkg}/wasm/${file}`];
}

/** A parser file's bytes: from the bundle, from ~/.airband/wasm, or fetched once and kept there.
 *  A fetched file is used only when its size and SHA-256 match the build's; AIRBAND_OFFLINE=1
 *  never fetches. */
export async function grammarBytes(file: string): Promise<Uint8Array> {
  const expected = __AIRBAND_GRAMMARS__.files[file];
  const matches = (b: Uint8Array) => !!expected && b.length === expected.size && crypto.createHash("sha256").update(b).digest("hex") === expected.sha256;
  for (const dir of [bundledDir(), airbandFile("wasm")]) {
    if (!dir) continue;
    try {
      const b = fs.readFileSync(path.join(dir, file));
      // A file shipped with this build is trusted as is; one kept from a download is checked again.
      if (dir === bundledDir() || matches(b)) return b;
    } catch {
      // Not there.
    }
  }
  if (!expected) throw new Error(`No parser file ${file} in this build.`);
  const off = process.env.AIRBAND_OFFLINE;
  if (off && off !== "0" && off.toLowerCase() !== "false") throw new Error(`The parser for ${file} isn't on this computer, and AIRBAND_OFFLINE is set.`);
  let last: unknown;
  for (const url of grammarUrls(file)) {
    try {
      const b = await fetchGrammar(url);
      if (!matches(b)) throw new Error(`${url} sent a file that doesn't match the expected fingerprint`);
      writeFileAtomic(airbandFile("wasm", file), b);
      return b;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error(`Couldn't fetch the parser ${file}.`);
}

function bundledDir(): string | undefined {
  try {
    return wasmDir();
  } catch {
    return undefined;
  }
}

/** One HTTPS GET: follows up to 3 redirects, 30 s at most, 8 MB at most. */
function httpsGet(url: string, redirects = 3): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30_000, headers: { "user-agent": "airband" } }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url);
        if (next.protocol !== "https:") return reject(new Error("refused a redirect away from https"));
        return resolve(httpsGet(next.toString(), redirects - 1));
      }
      if (status !== 200) {
        res.resume();
        return reject(new Error(`${url} answered ${status}`));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 8 * 1024 * 1024) req.destroy(new Error("too large"));
        else chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    const deadline = setTimeout(() => req.destroy(new Error("timed out")), 30_000);
    deadline.unref();
    req.on("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
  });
}

export function langOf(file: string): LangId | undefined {
  return BY_EXT[path.extname(file).toLowerCase()];
}

/** Where the .wasm files are: next to the running bundle in a build, the package itself in tests. */
function wasmDir(): string {
  const candidates = [process.env.AIRBAND_WASM_DIR, path.join(__dirname, "wasm")];
  try {
    candidates.push(path.join(path.dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")), "wasm"));
  } catch {
    // Not installed: only the bundled copy can be used.
  }
  for (const dir of candidates) if (dir && fs.existsSync(path.join(dir, "tree-sitter.wasm"))) return dir;
  throw new Error("Airband's parser files (tree-sitter .wasm) are missing.");
}

let ready: Promise<void> | undefined;
const languages = new Map<LangId, Promise<Language>>();

function init(): Promise<void> {
  if (!ready) {
    const dir = wasmDir();
    ready = TreeSitter.Parser.init({ locateFile: (file: string) => path.join(dir, file) });
  }
  return ready;
}

async function language(id: LangId): Promise<Language> {
  await init();
  let l = languages.get(id);
  if (!l) {
    // A language that can't be loaded (offline, say) stays failed for this run: its files are left
    // as they were and tried again next time, instead of fetching once per file.
    l = grammarBytes(GRAMMAR[id]).then((bytes) => TreeSitter.Language.load(bytes));
    languages.set(id, l);
  }
  return l;
}

const parsers = new Map<LangId, import("@vscode/tree-sitter-wasm").Parser>();

/** Parses a file's text; the tree must be deleted by the caller once read. */
export async function parse(id: LangId, text: string): Promise<Tree | null> {
  const lang = await language(id);
  let p = parsers.get(id);
  if (!p) {
    p = new TreeSitter.Parser();
    p.setLanguage(lang);
    parsers.set(id, p);
  }
  return p.parse(text);
}

const queries = new Map<string, Query>();

export async function query(id: LangId, source: string): Promise<Query> {
  const key = `${id}\0${source}`;
  let q = queries.get(key);
  if (!q) {
    q = new TreeSitter.Query(await language(id), source);
    queries.set(key, q);
  }
  return q;
}
