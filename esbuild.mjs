// Builds what Airband ships, all from TypeScript:
//   dist/extension.js     the VS Code extension (Node, CommonJS, `vscode` left external)
//   dist/airband-hook.js  the hook agents run after each reply: live status, sharing, writing checks
//   dist/airband-mcp.js   the MCP server: the map, flightlogs and notes for any agent
//   dist/airband.js       the command line: map, find, check, backup ... on any computer
//   dist/webview.js       the React pages for the sidebar and the board (+ webview.css)
//   dist/companion/       Roger's screen (ui.js + ui.css): the desktop corner and the phone page
//   dist/wasm/            the code map's parser (tree-sitter runtime and grammars)
// `--tour` instead builds only the desktop app's setup tour into desktop/ui/ (setup.js + setup.css).
// `--tests` instead builds test/*.test.ts into out-test/ for `node --test`.
import { build, context } from "esbuild";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { browser, VERSION } from "./scripts/esbuild-presets.mjs";

const watch = process.argv.includes("--watch");
const tests = process.argv.includes("--tests");
const tour = process.argv.includes("--tour");

// The parser files and their fingerprints. The npm package carries only the common ones; the rest
// are fetched the first time a project needs them and must match these hashes byte for byte.
const grammarPkgDir = dirname(createRequire(import.meta.url).resolve("@vscode/tree-sitter-wasm/package.json"));
const grammarPkg = JSON.parse(readFileSync(join(grammarPkgDir, "package.json"), "utf8"));
const GRAMMAR_FILES = {};
for (const f of readdirSync(join(grammarPkgDir, "wasm")).filter((f) => f.endsWith(".wasm"))) {
  const bytes = readFileSync(join(grammarPkgDir, "wasm", f));
  GRAMMAR_FILES[f] = { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}
const GRAMMARS_INFO = { pkg: `${grammarPkg.name}@${grammarPkg.version}`, files: GRAMMAR_FILES };

// The Agent SDK is an ES module that reads `import.meta.url`; in a CommonJS
// bundle that is undefined, so it is defined from the bundle's own file name.
const node = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: watch || tests,
  logLevel: "info",
  banner: { js: 'const __airband_import_meta_url = require("url").pathToFileURL(__filename).href;' },
  define: { "import.meta.url": "__airband_import_meta_url", __AIRBAND_VERSION__: JSON.stringify(VERSION), __AIRBAND_GRAMMARS__: JSON.stringify(GRAMMARS_INFO) },
  // The Library's commands are Markdown files, bundled as text.
  loader: { ".md": "text" },
};

const configs = tour
  ? // The desktop app's first-run window. It runs before anything is checked, so it asks the least
    // of the webview: es2020.
    [{ ...browser({ dev: watch }), target: "es2020", entryPoints: ["desktop/tour/setup.tsx"], outfile: "desktop/ui/setup.js" }]
  : tests
  ? [
      {
        ...node,
        entryPoints: readdirSync("test").filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`),
        outdir: "out-test",
        external: ["vscode"],
      },
    ]
  : [
      { ...node, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", external: ["vscode"] },
      { ...node, entryPoints: ["src/hook/bin.ts"], outfile: "dist/airband-hook.js" },
      { ...node, entryPoints: ["src/mcp/bin.ts"], outfile: "dist/airband-mcp.js" },
      // The command line runs as `airband ...` once installed from npm, so it starts with a shebang.
      { ...node, entryPoints: ["src/cli/bin.ts"], outfile: "dist/airband.js", banner: { js: "#!/usr/bin/env node\n" + node.banner.js } },
      { ...browser({ dev: watch }), entryPoints: ["webview-ui/main.tsx"], outfile: "dist/webview.js" },
      // Served by the Station: the Airband app's corner on the desktop and the phone page.
      { ...browser({ dev: watch }), entryPoints: ["companion/main.tsx"], outfile: "dist/companion/ui.js" },
    ];

// The code map's parser: tree-sitter's runtime and the grammars Airband reads, next to the bundles.
const GRAMMARS = [
  "tree-sitter.wasm",
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
  "tree-sitter-javascript.wasm",
  "tree-sitter-python.wasm",
  "tree-sitter-go.wasm",
  "tree-sitter-rust.wasm",
  "tree-sitter-java.wasm",
  "tree-sitter-c-sharp.wasm",
  "tree-sitter-ruby.wasm",
  "tree-sitter-php.wasm",
];
if (!tests && !tour) {
  const from = join(dirname(createRequire(import.meta.url).resolve("@vscode/tree-sitter-wasm/package.json")), "wasm");
  mkdirSync("dist/wasm", { recursive: true });
  for (const g of GRAMMARS) copyFileSync(join(from, g), join("dist/wasm", g));
}

if (watch) {
  for (const c of configs) await (await context(c)).watch();
} else {
  await Promise.all(configs.map((c) => build(c)));
}
