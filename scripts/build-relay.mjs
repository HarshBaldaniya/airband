// Builds the phone app into relay/public/ for Airband's relay: app.js and app.css (the screens),
// sw.js (the service worker: notifications), and the Home Screen icons, drawn in code.
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { browser as page, VERSION } from "./esbuild-presets.mjs";

const out = "relay/public";
const browser = { ...page(), logLevel: "warning", legalComments: "eof" };
await build({ ...browser, entryPoints: ["companion/phone/main.tsx"], outfile: join(out, "app.js") });
await build({ ...browser, entryPoints: ["companion/phone/sw.ts"], outfile: join(out, "sw.js") });

const tool = join("relay", ".wrangler", "icon-tool.cjs");
mkdirSync(join("relay", ".wrangler"), { recursive: true });
await build({ bundle: true, platform: "node", format: "cjs", entryPoints: ["scripts/icon.ts"], outfile: tool, logLevel: "warning" });
const { phoneIconPng } = createRequire(import.meta.url)(join(process.cwd(), tool));
for (const size of [180, 192, 512]) writeFileSync(join(out, `icon-${size}.png`), phoneIconPng(size));
rmSync(tool, { force: true });
console.log(`Phone app ${VERSION}: ${out}/app.js, app.css, sw.js, icon-180/192/512.png`);
