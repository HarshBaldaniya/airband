// The desktop app's version and its files' names on a GitHub release, for the release scripts.
// The version is package.json's (tauri.conf.json reads it from there too); the names are in
// desktop/downloads.json; the releases' address is the updater's endpoint in tauri.conf.json.
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

export const VERSION = json("package.json").version;
export const NAMES = json("desktop/downloads.json");

const endpoint = json("desktop/src-tauri/tauri.conf.json").plugins.updater.endpoints[0];
/** https://github.com/<owner>/<repo>/releases */
export const RELEASES = endpoint.replace(/\/latest\/download\/latest\.json$/, "");
if (RELEASES === endpoint) throw new Error("the updater's endpoint doesn't end with /latest/download/latest.json");

/** The name of a release file (a key of desktop/downloads.json) for `version`. */
export function download(key, version = VERSION) {
  const name = key === "about" ? undefined : NAMES[key];
  if (typeof name !== "string") throw new Error(`desktop/downloads.json has no "${key}"`);
  return name.replaceAll("{version}", version);
}
