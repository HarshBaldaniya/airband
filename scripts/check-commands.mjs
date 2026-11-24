// Checks that the desktop app's commands agree everywhere they are named, without building it.
// A command the screen calls has to be in four places, and missing from any one of them it is
// refused with no error on screen:
//   1. tauri::generate_handler![...] in desktop/src-tauri/src   (the app answers it)
//   2. the list in desktop/src-tauri/build.rs                  (a permission is made for it)
//   3. a capability in desktop/src-tauri/capabilities/          (a window may call it)
//   4. the page that calls it: the corner's bridge (src/**/*.js, src/**/*.rs) or the setup tour
// Each window's capability must also grant nothing its page does not call.
// Run: node scripts/check-commands.mjs (CI runs it in .github/workflows/test.yml).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const app = "desktop/src-tauri";
const files = (dir, ext) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : ext.some((e) => p.endsWith(e)) ? [p] : [];
  });
const read = (f) => readFileSync(f, "utf8");
const all = (text, re) => [...text.matchAll(re)].map((m) => m[1]);
const kebab = (name) => name.replaceAll("_", "-");
const problems = [];
const same = (what, a, b, aName, bName) => {
  for (const x of a) if (!b.has(x)) problems.push(`${what}: "${x}" is in ${aName} but not in ${bName}`);
  for (const x of b) if (!a.has(x)) problems.push(`${what}: "${x}" is in ${bName} but not in ${aName}`);
};

// 1. What the app answers: the last part of each path in generate_handler![...].
const rust = files(join(app, "src"), [".rs"]).map(read).join("\n");
const handler = /generate_handler!\[([^\]]*)\]/.exec(rust);
if (!handler) problems.push("no tauri::generate_handler![...] found in desktop/src-tauri/src");
const handled = new Set(
  (handler?.[1] ?? "")
    .split(",")
    .map((p) => p.trim().split("::").at(-1))
    .filter(Boolean),
);

// 2. What build.rs declares.
const buildRs = read(join(app, "build.rs"));
const list = /\.commands\(&\[([^\]]*)\]/.exec(buildRs);
if (!list) problems.push("no AppManifest::commands(&[...]) list found in build.rs");
const declared = new Set(all(list?.[1] ?? "", /"([a-z0-9_]+)"/g));
same("commands", handled, declared, "generate_handler!", "build.rs");

// 3. What each capability grants (the app's own permissions, not core:* or plugins').
const capabilities = Object.fromEntries(
  files(join(app, "capabilities"), [".json"]).map((f) => {
    const c = JSON.parse(read(f));
    const own = new Set(c.permissions.filter((p) => typeof p === "string" && p.startsWith("allow-")).map((p) => p.slice(6)));
    return [c.identifier, { windows: c.windows, own }];
  }),
);
const granted = new Set(Object.values(capabilities).flatMap((c) => [...c.own]));
for (const g of granted) if (![...declared].some((d) => kebab(d) === g)) problems.push(`capabilities grant "allow-${g}", which build.rs doesn't declare`);
for (const d of declared) if (!granted.has(kebab(d))) problems.push(`"${d}" is declared but no capability grants it, so no window can call it`);

// 4. What each page calls. The corner's bridge is written in Rust's src (bridge.js, or a string in
// a .rs file); the tour's calls are call("…") / call<T>("…") in desktop/tour.
const bridge = files(join(app, "src"), [".js", ".rs"]).map(read).join("\n");
const cornerCalls = new Set(all(bridge, /invoke\("([a-z0-9_]+)"/g));
const tourCalls = new Set(all(files("desktop/tour", [".ts", ".tsx"]).map(read).join("\n"), /call(?:<[^>]*>)?\("([a-z0-9_]+)"/g));
const pages = { main: ["the corner's bridge", cornerCalls], setup: ["the setup tour", tourCalls] };
for (const [window, [name, calls]] of Object.entries(pages)) {
  const cap = Object.values(capabilities).find((c) => c.windows.includes(window));
  if (!cap) {
    problems.push(`no capability for the "${window}" window`);
    continue;
  }
  same(`the "${window}" window`, new Set([...calls].map(kebab)), cap.own, name, "its capability");
  for (const c of calls) if (!handled.has(c)) problems.push(`${name} calls "${c}", which the app doesn't answer`);
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`✓ ${handled.size} desktop commands agree: generate_handler!, build.rs, capabilities and the pages that call them`);
