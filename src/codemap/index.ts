// The code map: every file, declaration, import and caller of a codebase, read by a parser (no AI),
// kept fresh by content hash, and answered in a few hundred tokens with exact `path:start-end`.
import * as fs from "node:fs";
import * as path from "node:path";
import { extract } from "./extract";
import { CodeGraph } from "./graph";
import { checkDocs, computeConventions, computeModules, type Convention, type Module, type StaleDocLine } from "./modules";
import { approveModuleDoc, readModuleDoc, type ModuleDoc } from "./moduledocs";
import { langOf } from "./parser";
import { makeResolver, type Resolver } from "./resolve";
import { SearchIndex, words, type Hit } from "./search";
import { contentHash, listFiles, loadEntries, MAX_FILE_BYTES, readMeta, saveEntries, storeDir, type FileEntry } from "./store";
import { findHits, findText } from "./answers/find";
import type { MappedCode } from "./answers/format";
import { graphText } from "./answers/graph";
import { outlineText } from "./answers/outline";
import { overviewText } from "./answers/overview";
import type { FindOptions } from "./answers/tokens";
import { unusedCode, unusedText } from "./answers/unused";

export interface CodeMapStats {
  files: number;
  decls: number;
  parsed: number;
  removed: number;
  ms: number;
  bytes?: number;
}


const LIST_EVERY_MS = 30_000;

export class CodeMap implements MappedCode {
  private files = new Map<string, FileEntry>();
  private loaded = false;
  private lastListed = 0;
  /** Each mapped folder's modified time when last listed: a new or removed file changes it. */
  private dirTimes = new Map<string, number>();
  private resolverCache?: Resolver;
  private graphCache?: CodeGraph;
  private searchCache?: SearchIndex;
  private modulesCache?: Module[];
  private docsCache?: { at: number; lines: StaleDocLine[] };
  private sweeping?: Promise<CodeMapStats>;

  constructor(readonly root: string) {}

  private load() {
    if (this.loaded) return;
    this.files = loadEntries(this.root);
    this.loaded = true;
  }

  private invalidate() {
    this.resolverCache = undefined;
    this.graphCache = undefined;
    this.searchCache = undefined;
    this.modulesCache = undefined;
    this.docsCache = undefined;
  }

  /** The code's main parts, most depended on first. */
  modules(): Module[] {
    this.load();
    return (this.modulesCache ??= computeModules(this.files.values(), this.graph));
  }

  moduleOf(file: string): Module | undefined {
    return this.modules().find((m) => m.files.includes(file));
  }

  /** How this codebase (or one module) names and lays things out. */
  conventions(moduleId?: string): Convention[] {
    this.load();
    const files = moduleId ? (this.modules().find((m) => m.id === moduleId)?.files ?? []).map((p) => this.files.get(p)!).filter(Boolean) : [...this.files.values()];
    return computeConventions(files);
  }

  /** A module's doc: missing, draft or approved, and whether its code moved on since. */
  moduleDoc(moduleId: string): ModuleDoc | undefined {
    const m = this.moduleOrFolder(moduleId);
    return m ? readModuleDoc(this.root, m, this.files, storeDir(this.root)) : undefined;
  }

  approveModuleDoc(moduleId: string): ModuleDoc | undefined {
    const m = this.moduleOrFolder(moduleId);
    return m ? approveModuleDoc(this.root, m, this.files, storeDir(this.root)) : undefined;
  }

  /**
   * A module by id, or any folder taken as one. A part of the code with a doc keeps its name even
   * if it shrinks below a module's size, or the grouping around it changes.
   */
  moduleOrFolder(id: string): Module | undefined {
    const found = this.modules().find((x) => x.id === id);
    if (found) return found;
    const prefix = `${id.replace(/\/$/, "")}/`;
    const files = [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort();
    return files.length ? { id: id.replace(/\/$/, ""), files, rank: 0, cohesion: 1, dependsOn: [] } : undefined;
  }

  /** Whether a name a doc mentions still exists: a file, a folder, or a declaration. */
  nameExists(name: string): boolean {
    this.load();
    const rel = name.replace(/^\.\//, "");
    if (this.files.has(rel) || fs.existsSync(path.join(this.root, rel))) return true;
    for (const f of this.files.values()) if (f.d.some((d) => d.n === name)) return true;
    return false;
  }

  /** Doc lines naming a file, symbol or script that no longer exists (checked at most every 10 s). */
  staleDocs(): StaleDocLine[] {
    this.load();
    if (this.docsCache && Date.now() - this.docsCache.at < 10_000) return this.docsCache.lines;
    const lines = checkDocs(this.root, this.files, new Set(this.files.keys()));
    this.docsCache = { at: Date.now(), lines };
    return lines;
  }

  get resolver(): Resolver {
    this.load();
    return (this.resolverCache ??= makeResolver(this.root, new Set(this.files.keys())));
  }

  get graph(): CodeGraph {
    return (this.graphCache ??= new CodeGraph(this.files, this.resolver));
  }

  get searchIndex(): SearchIndex {
    this.load();
    return (this.searchCache ??= new SearchIndex(this.files.values()));
  }

  entries(): Iterable<FileEntry> {
    this.load();
    return this.files.values();
  }

  file(p: string): FileEntry | undefined {
    this.load();
    return this.files.get(p);
  }

  paths(): string[] {
    this.load();
    return [...this.files.keys()];
  }

  fileCount(): number {
    this.load();
    return this.files.size;
  }

  /** Whether a map has been built for this folder. */
  exists(): boolean {
    return !!readMeta(this.root);
  }

  /**
   * Brings the map up to date. With `changed`, only those files are looked at (a save); otherwise every
   * known file's size and time is checked, and the file list itself at most every 30 s. Only files whose
   * content changed are parsed again. Never runs twice at once.
   */
  refresh(opts: { changed?: string[]; full?: boolean; yieldEvery?: number } = {}): Promise<CodeMapStats> {
    if (this.sweeping) return this.sweeping.then(() => this.refresh(opts));
    this.sweeping = this.doRefresh(opts).finally(() => (this.sweeping = undefined));
    return this.sweeping;
  }

  private async doRefresh({ changed, full, yieldEvery = 12 }: { changed?: string[]; full?: boolean; yieldEvery?: number }): Promise<CodeMapStats> {
    const t0 = Date.now();
    this.load();
    let paths: string[];
    let removed = 0;
    const listing = full || !this.files.size || Date.now() - this.lastListed > LIST_EVERY_MS || this.foldersChanged();
    if (changed && !full) {
      paths = changed.map((p) => (path.isAbsolute(p) ? path.relative(this.root, p) : p).split(path.sep).join("/")).filter((p) => !p.startsWith(".."));
    } else if (listing) {
      paths = await listFiles(this.root);
      this.lastListed = Date.now();
      this.rememberFolders(paths);
      // Which imports are this codebase's own depends on its folders: decide with today's list,
      // not the one from before (on a first build, an empty one).
      this.resolverCache = makeResolver(this.root, new Set(paths));
      const keep = new Set(paths);
      for (const p of [...this.files.keys()]) {
        if (!keep.has(p)) {
          this.files.delete(p);
          removed++;
        }
      }
    } else {
      paths = [...this.files.keys()];
    }

    const isLocal = (s: string) => this.resolver.isLocal(s);
    let parsed = 0;
    let lastYield = Date.now();
    for (const p of paths) {
      if (!langOf(p)) continue;
      const abs = path.join(this.root, p);
      let st: fs.Stats;
      try {
        // lstat: a symlink in a repo can point anywhere (~/.aws/credentials), and the map would then
        // show its lines to agents. Linked files are left out; their target is mapped where it lives.
        st = fs.lstatSync(abs);
      } catch {
        if (this.files.delete(p)) removed++;
        continue;
      }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) {
        if (this.files.delete(p)) removed++;
        continue;
      }
      const prev = this.files.get(p);
      if (prev && prev.z === st.size && prev.m === Math.floor(st.mtimeMs)) continue;
      let text: string;
      try {
        text = fs.readFileSync(abs, "utf8");
      } catch {
        continue;
      }
      const h = contentHash(text);
      if (prev && prev.h === h) {
        prev.m = Math.floor(st.mtimeMs);
        prev.z = st.size;
        parsed++; // the time changed; counts as touched so the store is saved
        continue;
      }
      try {
        const facts = await extract(langOf(p)!, text, isLocal);
        const entry: FileEntry = { p, l: langOf(p)!, h, z: st.size, m: Math.floor(st.mtimeMs), n: facts.lines, d: facts.decls, i: facts.imports };
        if (facts.def) entry.def = facts.def;
        this.files.set(p, entry);
        parsed++;
      } catch {
        // A file the parser can't read stays as it was; the next save tries again.
      }
      // Give the host a breath now and then, so a full build never freezes the editor.
      if (Date.now() - lastYield > yieldEvery) {
        await new Promise((r) => setImmediate(r));
        lastYield = Date.now();
      }
    }

    let bytes: number | undefined;
    if (parsed || removed || !this.exists()) {
      // Paths can appear or vanish: the resolver's file list must follow.
      this.invalidate();
      bytes = saveEntries(this.root, [...this.files.values()].sort((a, b) => (a.p < b.p ? -1 : 1))).bytes;
    }
    let decls = 0;
    for (const f of this.files.values()) decls += f.d.length;
    return { files: this.files.size, decls, parsed, removed, ms: Date.now() - t0, bytes };
  }

  private rememberFolders(paths: string[]) {
    this.dirTimes.clear();
    const dirs = new Set<string>([""]);
    for (const p of paths) {
      let d = path.posix.dirname(p);
      while (d !== "." && !dirs.has(d)) {
        dirs.add(d);
        d = path.posix.dirname(d);
      }
    }
    for (const d of dirs) {
      try {
        this.dirTimes.set(d, fs.statSync(path.join(this.root, d)).mtimeMs);
      } catch {
        // Gone already; the next listing settles it.
      }
    }
  }

  /** Whether any mapped folder gained or lost an entry since the last listing (a stat per folder). */
  private foldersChanged(): boolean {
    if (!this.dirTimes.size) return false;
    for (const [d, t] of this.dirTimes) {
      try {
        if (fs.statSync(path.join(this.root, d)).mtimeMs !== t) return true;
      } catch {
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ answers (answers/)

  /** Ranked declarations and files for a question. */
  findHits(question: string, opts: FindOptions = {}): Hit[] {
    return findHits(this, question, opts);
  }

  find(question: string, opts: FindOptions = {}): string {
    return findText(this, question, opts);
  }

  /** One level of a folder, a file or a symbol. */
  outline(target: string, budget?: number): string {
    return outlineText(this, target, budget);
  }

  /** Who uses a symbol or file and what it uses, one or two hops. */
  graphOf(target: string, hops: 1 | 2 = 1, budget?: number): string {
    return graphText(this, target, hops, budget);
  }

  /** The project card: how to run it, its entry points and its main folders. */
  overview(budget?: number): string {
    return overviewText(this, budget);
  }

  unused(): ReturnType<typeof unusedCode> {
    return unusedCode(this);
  }

  unusedText(budget?: number): string {
    return unusedText(this, budget);
  }















  /** Words that would find this file: used by the replay benchmark and the Board. */
  static words = words;
}
