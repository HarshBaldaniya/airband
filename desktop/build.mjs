// Builds the Airband app from the same TypeScript as the npm package:
//   dist/main.js      the app: the Station and the companion's window (Electron's main process)
//   dist/preload.js   the narrow bridge the companion's screen gets
//   build/icon.png    the app icon, drawn in code
// The companion's screen itself (ui.js, ui.css) and the hook come from the root build (../dist), which
// runs first: `npm run desktop:build` in the repository root does both.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const VERSION = rootPkg.version;

if (!existsSync(join(root, "dist", "companion", "ui.js")) || !existsSync(join(root, "dist", "airband-hook.js"))) {
  console.error("Build Airband first: run `npm run build` in the repository root (or `npm run desktop:build`).");
  process.exit(1);
}

// The app's version is Airband's.
const pkgFile = join(here, "package.json");
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
if (pkg.version !== VERSION) {
  pkg.version = VERSION;
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
}

// The parser files' fingerprints, as the root build defines them (setup and the code map read them).
const require = createRequire(join(root, "package.json"));
const grammarPkgDir = dirname(require.resolve("@vscode/tree-sitter-wasm/package.json"));
const grammarPkg = JSON.parse(readFileSync(join(grammarPkgDir, "package.json"), "utf8"));
const files = {};
for (const f of readdirSync(join(grammarPkgDir, "wasm")).filter((f) => f.endsWith(".wasm"))) {
  const bytes = readFileSync(join(grammarPkgDir, "wasm", f));
  files[f] = { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

const node = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  logLevel: "info",
  external: ["electron"],
  banner: { js: 'const __airband_import_meta_url = require("url").pathToFileURL(__filename).href;' },
  define: { "import.meta.url": "__airband_import_meta_url", __AIRBAND_VERSION__: JSON.stringify(VERSION), __AIRBAND_GRAMMARS__: JSON.stringify({ pkg: `${grammarPkg.name}@${grammarPkg.version}`, files }) },
  loader: { ".md": "text" },
};

await build({ ...node, entryPoints: [join(here, "src/main.ts")], outfile: join(here, "dist/main.js") });
// The preload runs sandboxed: it may load only `electron`, so it gets none of the Node banner.
await build({ bundle: true, platform: "node", format: "cjs", target: "node20", logLevel: "info", external: ["electron"], entryPoints: [join(here, "src/preload.ts")], outfile: join(here, "dist/preload.js") });

// The icon: the companion on a dark tile, 1024 px, for the Mac, Windows and Linux builds.
await build({ ...node, entryPoints: [join(here, "src/icon.ts")], outfile: join(here, "dist/icon-tool.cjs"), logLevel: "warning" });
const { appIconPng } = createRequire(import.meta.url)(join(here, "dist/icon-tool.cjs"));
mkdirSync(join(here, "build"), { recursive: true });
writeFileSync(join(here, "build/icon.png"), appIconPng(1024));
console.log(`Airband app ${VERSION}: dist/main.js, dist/preload.js, build/icon.png`);
