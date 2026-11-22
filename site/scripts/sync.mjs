// Copies what the site shares with the app, so there is one source for each:
//   Roger (companion/figure and its sounds)       -> roger/
//   the wordmark and icon (media/)               -> public/brand/
//   the agents' logos (the app's icon set)        -> public/brand/agents/
import { cpSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(site, "..");
rmSync(join(site, "roger"), { recursive: true, force: true });
mkdirSync(join(site, "roger"), { recursive: true });
cpSync(join(repo, "companion/figure"), join(site, "roger/companion"), {
  recursive: true,
  // Only the figure: the rest of the folder is the app's state.
  filter: (f) => !/useCompanionState|lines\.ts|mood\.ts/.test(f),
});
copyFileSync(join(repo, "companion/sound.ts"), join(site, "roger/sound.ts"));
mkdirSync(join(site, "public/brand"), { recursive: true });
for (const f of ["airband-wordmark-dark.svg", "airband-wordmark-light.svg", "airband-icon.svg", "icon.png"]) copyFileSync(join(repo, "media", f), join(site, "public/brand", f));
copyFileSync(join(repo, "media/airband-icon.svg"), join(site, "app/icon.svg"));
// The agents' own marks (LobeHub's icon set, MIT; the marks belong to their owners), as the app shows them.
mkdirSync(join(site, "public/brand/agents"), { recursive: true });
for (const f of ["claudecode-color", "codex-color", "gemini-color"]) copyFileSync(join(site, "node_modules/@lobehub/icons-static-svg/icons", `${f}.svg`), join(site, "public/brand/agents", `${f.replace("-color", "")}.svg`));
// The wordmark inline, so its dot can move on hover: a ripple circle goes in behind the dot.
const mark = readFileSync(join(repo, "media/airband-wordmark-dark.svg"), "utf8")
  .replace(/<circle ([^>]*)\/>/, (_, a) => `<circle class="ripple" ${a.replace(/fill="[^"]*"/, 'fill="none" stroke="#E07A4F" stroke-width="40"')}/><circle class="dot" ${a}/>`);
writeFileSync(join(site, "roger/wordmark.ts"), `// Made by scripts/sync.mjs from media/airband-wordmark-dark.svg.\nexport const WORDMARK = ${JSON.stringify(mark)};\n`);
console.log("synced Roger and the brand from the app");
