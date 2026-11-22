// Puts together the npm package, airband: the `airband` command (setup, doctor, update,
// remove, and the Map's find, outline, graph ...), the MCP server, the hook and the parser files.
// The same files the VS Code extension carries, so both install exactly the same thing.
//   npm run pack:npm      → npm-dist/ (try it with `npm install -g ./npm-dist`)
//   npm publish ./npm-dist --access public
// One package: `npx airband` sets everything up, `npm i -g airband` installs the command.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = JSON.parse(readFileSync("package.json", "utf8"));
const out = "npm-dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "wasm"), { recursive: true });
for (const f of ["airband.js", "airband-mcp.js", "airband-hook.js"]) copyFileSync(join("dist", f), join(out, f));
// The companion's screen, which `airband station` serves to a browser or a phone.
mkdirSync(join(out, "companion"), { recursive: true });
for (const f of ["ui.js", "ui.css"]) copyFileSync(join("dist/companion", f), join(out, "companion", f));
// Only the common parsers ride along (BUNDLED_GRAMMARS in src/codemap/parser.ts; keep the two the
// same). Go, Rust, Java, C#, Ruby and PHP are fetched the first time a project needs them, checked
// against fingerprints written in at build time: the package is a third of the size.
const BUNDLED = ["tree-sitter.wasm", "tree-sitter-typescript.wasm", "tree-sitter-tsx.wasm", "tree-sitter-javascript.wasm", "tree-sitter-python.wasm"];
for (const f of BUNDLED) copyFileSync(join("dist/wasm", f), join(out, "wasm", f));
for (const f of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) copyFileSync(f, join(out, f));

const pkg = {
  name: "airband",
  version: root.version,
  description: "Connect your Claude Code, Codex and Gemini CLI chats so each one knows what the others did: a code map, shared chat records and 15 skills for every agent.",
  // What people type into npm search: the agents, and what Airband does for them.
  keywords: ["claude-code", "claude", "codex", "openai-codex", "gemini-cli", "gemini", "mcp", "mcp-server", "ai-agents", "ai-coding", "coding-agent", "code-map", "code-search", "skills", "cli", "developer-tools"],
  homepage: "https://airband.harshbaldaniya.com",
  bugs: { url: "https://github.com/HarshBaldaniya/airband/issues" },
  repository: { type: "git", url: "git+https://github.com/HarshBaldaniya/airband.git" },
  license: "MIT",
  author: root.author,
  // One command, so `npx airband` knows what to run.
  bin: { airband: "airband.js" },
  files: ["airband.js", "airband-mcp.js", "airband-hook.js", "wasm/", "companion/", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"],
  engines: { node: ">=20" },
  publishConfig: { access: "public" },
};
writeFileSync(join(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

// The npm page: its own short README, kept in npm/README.md.
copyFileSync(join("npm", "README.md"), join(out, "README.md"));
console.log(`npm-dist/ ready: ${pkg.name}@${pkg.version}`);

