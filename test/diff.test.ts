// What a branch changed, read from git at both ends: declarations added, changed and removed, who
// calls them and which tests reach them; and asking another mapped project by its name.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { CodeMap } from "../src/codemap/index";
import { diffReport, isTestFile, renderDiff, resolveRange } from "../src/codemap/diff";
import { findProject, mappedProjects } from "../src/codemap/where";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
beforeEach(() => {
  process.env.AIRBAND_HOME = tmp("airband-diff-home-");
});

const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com", GIT_CONFIG_NOSYSTEM: "1", HOME: os.tmpdir() };
const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function write(root: string, files: Record<string, string | null>) {
  for (const [p, text] of Object.entries(files)) {
    const f = path.join(root, p);
    if (text === null) fs.rmSync(f);
    else {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, text);
    }
  }
}

const SEATS_V1 = `export function syncSeats(n: number): number {
  return n;
}

export function oldSeats(): number {
  return seatBase();
}

function seatBase(): number {
  return 1;
}
`;
const SEATS_V2 = `export function syncSeats(n: number): number {
  return Math.max(0, n);
}

export function seatLimit(): number {
  return 10;
}

function seatBase(): number {
  return 1;
}
`;

function repo(): string {
  const root = path.join(tmp("airband-diff-"), "my-api");
  fs.mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  write(root, {
    "src/seats.ts": SEATS_V1,
    "src/billing.ts": `import { syncSeats, oldSeats } from "./seats";\nexport function bill(): number {\n  return syncSeats(oldSeats());\n}\n`,
    "test/seats.test.ts": `import { syncSeats } from "../src/seats";\nexport function checks() {\n  return syncSeats(2);\n}\n`,
    "README.md": "# app\n",
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "first");
  git(root, "checkout", "-q", "-b", "feature/seats");
  write(root, { "src/seats.ts": SEATS_V2, "README.md": "# app\n\nSeats.\n", "test/seats.test.ts": `import { syncSeats } from "../src/seats";\nexport function checks() {\n  return syncSeats(-1);\n}\n` });
  git(root, "commit", "-q", "-am", "seats");
  git(root, "checkout", "-q", "main");
  return root;
}

test("a branch's changes, per declaration, with callers and tests, without checking it out", async () => {
  const root = repo();
  const map = new CodeMap(root);
  await map.refresh({ yieldEvery: 1e9 });
  const r = await diffReport(map, "feature/seats");
  assert.ok(typeof r !== "string", String(r));
  const by = Object.fromEntries(r.decls.map((d) => [d.name, d]));
  assert.equal(by.syncSeats.change, "changed");
  assert.equal(by.seatLimit.change, "added");
  assert.equal(by.oldSeats.change, "removed");
  assert.deepEqual(by.syncSeats.callers.map((e) => e.from.name).sort(), ["bill", "checks"]);
  assert.deepEqual(by.syncSeats.tests, ["test/seats.test.ts"]);
  assert.deepEqual(by.oldSeats.callers.map((e) => e.from.file), ["src/billing.ts"], "removed code something still calls");
  assert.equal(by.bill, undefined, "an untouched file's code is not listed");
  assert.deepEqual(r.other, ["README.md"]);
  assert.deepEqual(r.testsChanged, ["test/seats.test.ts"]);
  assert.equal(git(root, "rev-parse", "--abbrev-ref", "HEAD").trim(), "main", "nothing was checked out");

  const text = renderDiff(r);
  assert.match(text, /^main\.\.\.feature\/seats \(\w{9} → \w{9}\): \d+ declarations changed in 1 file\./);
  assert.match(text, /removed oldSeats function was :5-7 · still used by 1: bill src\/billing\.ts \(check these\)/);
  assert.match(text, /changed syncSeats function :1-3 · used by 2: .* · tests: test\/seats\.test\.ts/);
  assert.match(text, /Other files: README\.md/);
  assert.deepEqual(r.orphans.map((o) => [o.name, o.file, o.was]), [["seatBase", "src/seats.ts", ["oldSeats"]]], "only the removed code used it");
  assert.match(text, /Left with no caller \(only removed code used it\): seatBase src\/seats\.ts/);
  assert.ok(text.length / 4 < 900);

  // The same with a range written out.
  const ranged = await diffReport(map, "main..feature/seats");
  assert.ok(typeof ranged !== "string");
  assert.equal(ranged.decls.length, r.decls.length);
});

test("refs that are not refs are refused, never handed to git as options", () => {
  const root = repo();
  assert.match(String(resolveRange(root, "--output=/tmp/x")), /not a branch/);
  assert.match(String(resolveRange(root, "no-such-branch")), /not a branch, tag or commit/);
  assert.match(String(resolveRange(root, "main..-x")), /not a branch/);
  const self = resolveRange(root, "");
  assert.ok(typeof self !== "string" && self.base === self.head, "this branch against itself: nothing");
});

test("test files are told apart in the usual layouts", () => {
  for (const p of ["test/a.ts", "src/__tests__/b.tsx", "src/c.test.ts", "d.spec.js", "pkg/e_test.go", "tests/test_f.py", "app/FooTests.cs"]) assert.ok(isTestFile(p), p);
  for (const p of ["src/testing.ts", "src/contest.ts", "latest/x.py"]) assert.ok(!isTestFile(p), p);
});

test("another project is found by its folder's name, only when it was mapped", async () => {
  const root = repo();
  assert.match(String(findProject("my-api")), /No mapped project called "my-api"/);
  await new CodeMap(root).refresh({ yieldEvery: 1e9 });
  assert.deepEqual(mappedProjects().map((p) => p.name), ["my-api"]);
  const p = findProject("MY-API");
  assert.ok(typeof p !== "string");
  assert.equal(fs.realpathSync(p.root), fs.realpathSync(root));
  const q = findProject("api");
  assert.ok(typeof q !== "string", "part of the name is enough when only one matches");
});
