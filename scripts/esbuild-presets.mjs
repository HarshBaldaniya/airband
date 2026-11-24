// What every browser bundle shares: the Tower pages, Roger's screens, the phone app and the setup
// tour. esbuild.mjs and build-relay.mjs both start from it.
import { readFileSync } from "node:fs";

/** The version every piece reports, from package.json. */
export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

/** A React page for a browser or a webview. `dev` keeps it readable and maps it to the source. */
export function browser({ dev = false } = {}) {
  return {
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    jsx: "automatic",
    minify: !dev,
    sourcemap: dev,
    logLevel: "info",
    define: { "process.env.NODE_ENV": dev ? '"development"' : '"production"', __AIRBAND_VERSION__: JSON.stringify(VERSION) },
    // Agent logos are inlined as SVG text.
    loader: { ".svg": "text" },
  };
}
