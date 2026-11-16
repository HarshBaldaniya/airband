// What a branch or pull request changed, in code: the functions, classes and types it added,
// changed or removed (read from the syntax at both ends, no AI), who calls each of them, and which
// tests reach them. It reads git (never writes to the work tree), so it works on a PR branch that
// is not checked out: `main..feature`, a branch name, or `#853` (fetched from the remote first).
import { execFileSync } from "node:child_process";
import { extract, type Decl } from "./extract";
import { memberName, type Edge } from "./graph";
import type { CodeMap } from "./index";
import { langOf } from "./parser";

/** A ref as git takes it; nothing that could pass for an option. */
const REF = /^[A-Za-z0-9][A-Za-z0-9._/@~^{}-]*$/;
const PR_NUMBER = /^(?:#|pr[-/ ]?|pull\/)(\d{1,7})$/i;
/** More files than this and the rest are only named. */
const FILES_MAX = 40;
const FILE_BYTES_MAX = 512 * 1024;

const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|Tests?\.(cs|java)$|_spec\.rb$/;
export const isTestFile = (p: string) => TEST_FILE.test(p);

export interface ChangedDecl {
  change: "added" | "changed" | "removed" | "moved";
  file: string;
  /** Where a moved declaration was */
  from?: string;
  name: string;
  kind: string;
  s: number;
  e: number;
  exported: boolean;
  callers: Edge[];
  /** Tests that call it */
  tests: string[];
  /** Tests that import its file, when none calls it */
  fileTests: string[];
}

export interface DiffReport {
  base: string;
  head: string;
  label: string;
  decls: ChangedDecl[];
  /** Changed files with no code the map reads (docs, config, styles) */
  other: string[];
  /** Test files the change itself touches */
  testsChanged: string[];
  /** Code files past FILES_MAX, named only */
  skipped: string[];
}

function git(root: string, args: string[], maxBuffer = 16 * 1024 * 1024): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer, timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });
}

function commit(root: string, ref: string): string | undefined {
  if (!REF.test(ref)) return undefined;
  try {
    return git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** The branch PRs go into: the remote's default, else main or master. */
function defaultBranch(root: string): string | undefined {
  try {
    const head = git(root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).trim().replace(/^refs\/remotes\//, "");
    if (head && commit(root, head)) return head;
  } catch {
    // No remote HEAD recorded.
  }
  return ["origin/main", "main", "origin/master", "master", "origin/develop", "develop"].find((b) => commit(root, b));
}

/** A pull request's head, fetched from origin into FETCH_HEAD only (no branch is made or moved). */
function fetchPull(root: string, n: string): string | undefined {
  try {
    git(root, ["fetch", "--quiet", "--no-tags", "origin", `pull/${n}/head`]);
    return commit(root, "FETCH_HEAD");
  } catch {
    return undefined;
  }
}

/** "main..feature", "main...feature", "feature" (against the default branch), "#853", or nothing (this branch). */
export function resolveRange(root: string, range: string): { base: string; head: string; label: string } | string {
  const r = range.trim() || "HEAD";
  let baseRef: string | undefined;
  let headRef = r;
  const two = r.split(/\.{2,3}/);
  if (two.length === 2) [baseRef, headRef] = [two[0] || "HEAD", two[1] || "HEAD"];
  let head: string | undefined;
  const pr = PR_NUMBER.exec(headRef);
  if (pr) {
    head = commit(root, `origin/pr/${pr[1]}`) ?? fetchPull(root, pr[1]);
    if (!head) return `Could not get pull request #${pr[1]} from origin. Fetch it (git fetch origin pull/${pr[1]}/head) or name its branch.`;
    headRef = `#${pr[1]}`;
  } else {
    head = commit(root, headRef);
    if (!head) return `"${headRef}" is not a branch, tag or commit here. Try git fetch, or name it as origin/${headRef}.`;
  }
  baseRef ??= defaultBranch(root);
  if (!baseRef) return "No main or master branch to compare with: give a range like main..feature.";
  const baseTip = commit(root, baseRef);
  if (!baseTip) return `"${baseRef}" is not a branch, tag or commit here.`;
  let base: string;
  try {
    base = git(root, ["merge-base", baseTip, head]).trim();
  } catch {
    return `${baseRef} and ${headRef} share no history.`;
  }
  return { base, head, label: `${baseRef}...${headRef}` };
}

function show(root: string, rev: string, file: string): string | undefined {
  try {
    const text = git(root, ["show", `${rev}:${file}`], FILE_BYTES_MAX * 2);
    return text.length > FILE_BYTES_MAX ? undefined : text;
  } catch {
    return undefined;
  }
}

const declKey = (d: Decl) => `${memberName(d)}:${d.k}`;
const body = (lines: string[], d: Decl) => lines.slice(d.s - 1, d.e).map((l) => l.trim()).join("\n");

/** What changed between the two ends, declaration by declaration. */
export async function diffReport(map: CodeMap, range: string): Promise<DiffReport | string> {
  const root = map.root;
  const ends = resolveRange(root, range);
  if (typeof ends === "string") return ends;
  const { base, head, label } = ends;
  let listing: string;
  try {
    listing = git(root, ["diff", "--name-status", "-M", "--no-color", base, head]);
  } catch (err) {
    return `git could not compare them: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
  }
  const report: DiffReport = { base, head, label, decls: [], other: [], testsChanged: [], skipped: [] };
  const isLocal = (s: string) => map.resolver.isLocal(s);
  let read = 0;
  for (const line of listing.split("\n").filter(Boolean)) {
    const [status, a, b] = line.split("\t");
    const oldPath = a;
    const newPath = status.startsWith("R") || status.startsWith("C") ? b : a;
    if (isTestFile(newPath)) {
      // A test's own helpers are not the change under review: the test is named once below.
      report.testsChanged.push(newPath);
      continue;
    }
    const lang = langOf(newPath) ?? langOf(oldPath);
    if (!lang) {
      report.other.push(newPath);
      continue;
    }
    if (read >= FILES_MAX) {
      report.skipped.push(newPath);
      continue;
    }
    read++;
    const before = status.startsWith("A") ? "" : show(root, base, oldPath);
    const after = status.startsWith("D") ? "" : show(root, head, newPath);
    if (before === undefined || after === undefined) {
      report.other.push(newPath);
      continue;
    }
    const [was, now] = await Promise.all([before ? extract(lang, before, isLocal) : undefined, after ? extract(lang, after, isLocal) : undefined]);
    const wasLines = before.split("\n");
    const nowLines = after.split("\n");
    const old = new Map((was?.decls ?? []).map((d) => [declKey(d), d]));
    const fresh = new Map((now?.decls ?? []).map((d) => [declKey(d), d]));
    const found: { change: ChangedDecl["change"]; d: Decl; file: string }[] = [];
    for (const [k, d] of fresh) {
      const o = old.get(k);
      if (!o) found.push({ change: "added", d, file: newPath });
      else if (body(wasLines, o) !== body(nowLines, d)) found.push({ change: "changed", d, file: newPath });
    }
    for (const [k, d] of old) if (!fresh.has(k)) found.push({ change: "removed", d, file: oldPath });
    // A class whose methods are listed is not listed again for them.
    const parents = new Set(found.filter((f) => f.d.p).map((f) => `${f.file}#${f.d.p}`));
    for (const f of found) {
      if (f.change === "changed" && !f.d.p && parents.has(`${f.file}#${f.d.n}`)) continue;
      report.decls.push({ change: f.change, file: f.file, name: memberName(f.d), kind: f.d.k, s: f.d.s, e: f.d.e, exported: !!f.d.x, ...reach(map, f.file, memberName(f.d)) });
    }
  }
  // Removed in one file and added in another under the same name and kind: moved.
  for (const gone of report.decls.filter((d) => d.change === "removed")) {
    const to = report.decls.find((d) => d.change === "added" && d.name === gone.name && d.kind === gone.kind && d.file !== gone.file);
    if (!to) continue;
    to.change = "moved";
    to.from = gone.file;
    report.decls.splice(report.decls.indexOf(gone), 1);
  }
  return report;
}

/** Who calls it in this checkout's map, and the tests among them or importing its file. */
function reach(map: CodeMap, file: string, name: string): { callers: Edge[]; tests: string[]; fileTests: string[] } {
  const callers = map.graph.usedBy(file, name).filter((e) => !(e.from.file === file && e.from.name === name));
  const tests = new Set(callers.map((e) => e.from.file).filter(isTestFile));
  // Tests mostly call code from anonymous callbacks (`test("…", () => …)`), which no declaration
  // holds: a test file that imports the name itself counts as reaching it.
  const top = name.split(".")[0];
  const importing = [...(map.graph.importers.get(file) ?? [])].filter(isTestFile);
  for (const f of importing) if (map.file(f)?.i.some((imp) => imp.n?.includes(top) || imp.n?.includes("*"))) tests.add(f);
  const fileTests = tests.size ? [] : importing;
  return { callers, tests: [...tests], fileTests };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function callerList(edges: Edge[], n: number): string {
  const seen = new Set<string>();
  const uniq = edges.filter((e) => !seen.has(`${e.from.file}#${e.from.name}`) && seen.add(`${e.from.file}#${e.from.name}`));
  const shown = uniq.slice(0, n).map((e) => `${e.from.name} ${e.from.file}`);
  return `${shown.join(", ")}${uniq.length > n ? `, … ${uniq.length - n} more` : ""}`;
}

/** The report as a few hundred tokens: per file, each declaration with its callers and tests. */
export function renderDiff(r: DiffReport, budget = 900): string {
  const out: string[] = [];
  const files = new Set(r.decls.map((d) => d.file));
  out.push(`${r.label} (${r.base.slice(0, 9)} → ${r.head.slice(0, 9)}): ${plural(r.decls.length, "declaration")} changed in ${plural(files.size, "file")}. Callers are from this checkout's map.`);
  const order = { removed: 0, changed: 1, moved: 2, added: 3 } as const;
  for (const file of files) {
    out.push(file);
    const decls = r.decls.filter((d) => d.file === file).sort((a, b) => order[a.change] - order[b.change] || a.s - b.s);
    for (const d of decls) {
      const where = d.change === "removed" ? `was :${d.s}-${d.e}` : d.from ? `:${d.s}-${d.e} from ${d.from}` : `:${d.s}-${d.e}`;
      let reachText: string;
      if (d.change === "removed") reachText = d.callers.length ? `still used by ${d.callers.length}: ${callerList(d.callers, 4)} (check these)` : "used by nothing now";
      else reachText = d.callers.length ? `used by ${d.callers.length}: ${callerList(d.callers, 4)}` : d.exported && d.change !== "added" ? "used by nothing in this map" : ""; // New code's callers are in the change itself.
      const few = (t: string[]) => `${t.slice(0, 3).join(", ")}${t.length > 3 ? ` +${t.length - 3}` : ""}`;
      const tests = d.tests.length
        ? ` · tests: ${few(d.tests)}`
        : !d.exported || d.change === "removed"
          ? "" // Private code is tested through its file's exports.
          : d.fileTests.length
            ? ` · no test names it (tests import its file: ${few(d.fileTests)})`
            : d.change === "added"
            ? ""
            : " · no test reaches it";
      out.push(`  ${d.change.padEnd(7)} ${d.name} ${d.kind} ${where}${reachText ? ` · ${reachText}` : ""}${tests}`);
    }
  }
  if (r.testsChanged.length) out.push(`Tests changed: ${r.testsChanged.slice(0, 8).join(", ")}${r.testsChanged.length > 8 ? `, … ${r.testsChanged.length - 8} more` : ""}`);
  if (r.other.length) out.push(`Other files: ${r.other.slice(0, 10).join(", ")}${r.other.length > 10 ? `, … ${r.other.length - 10} more` : ""}`);
  if (r.skipped.length) out.push(`Not read (over ${FILES_MAX} code files): ${r.skipped.slice(0, 10).join(", ")}${r.skipped.length > 10 ? ` … ${r.skipped.length - 10} more` : ""}`);
  if (!r.decls.length && !r.other.length && !r.testsChanged.length) out.push("No files differ.");
  const text = out.join("\n");
  const max = budget * 4;
  if (text.length <= max) return text;
  const cut = text.lastIndexOf("\n", max - 40);
  return `${text.slice(0, cut > 0 ? cut : max - 40)}\n… (cut to fit; outline or graph one file for more)`;
}
