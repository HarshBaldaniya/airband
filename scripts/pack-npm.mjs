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
// Only the common parsers ride along (BUNDLED_GRAMMARS in src/codemap/parser.ts; keep the two the
// same). Go, Rust, Java, C#, Ruby and PHP are fetched the first time a project needs them, checked
// against fingerprints written in at build time: the package is a third of the size.
const BUNDLED = ["tree-sitter.wasm", "tree-sitter-typescript.wasm", "tree-sitter-tsx.wasm", "tree-sitter-javascript.wasm", "tree-sitter-python.wasm"];
for (const f of BUNDLED) copyFileSync(join("dist/wasm", f), join(out, "wasm", f));
for (const f of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) copyFileSync(f, join(out, f));

const pkg = {
  name: "airband",
  version: root.version,
  description: "Set up Claude Code, Codex and Gemini CLI with a map of your code, ready-made commands and shared chat records, in one command.",
  // What people type into npm search: the agents, and what Airband does for them.
  keywords: ["claude-code", "claude", "codex", "openai-codex", "gemini-cli", "gemini", "mcp", "mcp-server", "ai-agents", "ai-coding", "coding-agent", "code-map", "code-search", "skills", "cli", "developer-tools"],
  homepage: "https://github.com/HarshBaldaniya/airband#readme",
  bugs: { url: "https://github.com/HarshBaldaniya/airband/issues" },
  repository: { type: "git", url: "git+https://github.com/HarshBaldaniya/airband.git" },
  license: "MIT",
  author: root.author,
  // One command, so `npx airband` knows what to run.
  bin: { airband: "airband.js" },
  files: ["airband.js", "airband-mcp.js", "airband-hook.js", "wasm/", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"],
  engines: { node: ">=20" },
  publishConfig: { access: "public" },
};
writeFileSync(join(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

writeFileSync(
  join(out, "README.md"),
  `<p align="center"><img src="https://raw.githubusercontent.com/HarshBaldaniya/airband/main/media/airband-wordmark-light.png" alt="Airband" width="260"></p>

# airband

One command sets up **Claude Code**, **Codex** and **Gemini CLI** with a map of your code, ready-made
commands, skills, and shared records of your chats. No AI of its own, no server, no telemetry.

\`\`\`bash
npx airband           # set up every agent found, and add the airband command
\`\`\`

Or install the command first: \`npm i -g airband\`, then run \`airband\`. With other package
managers: \`pnpm dlx airband\`, \`yarn dlx airband\`, \`bunx airband\`.

\`\`\`bash
airband                    # what each agent has
airband doctor             # check everything works, with the fix for anything that doesn't
airband update             # move to the newest version and refresh every agent
airband remove             # take it all out again (--purge also deletes its data)
airband help               # every command
\`\`\`

Once set up, your agents:

- find code through the Map (\`airband_map\`) before grepping, in a few hundred tokens;
- read what your other chats did (\`airband_flightlog\`) and leave notes for each other (\`airband_notes\`);
- have ready-made commands (\`/airband:review\` in Claude Code, \`/prompts:review\` in Codex, \`/review\` in Gemini CLI);
- have seven skills they use by themselves: find code, recall past work, catch up on other chats, review a PR, check a change's impact, hand off work, pick up a ticket.

The Map also works on its own: \`airband find "rate limiter"\`, \`airband outline src/api\`, \`airband graph RateLimiter\`, \`airband diff #128\`.

Works on macOS (Apple silicon and Intel), Windows and Linux, with Node.js 20 or newer. The full app,
with the Tower board, Fuel and the Map as a picture, is the VS Code extension:
https://github.com/HarshBaldaniya/airband

MIT © Harsh Baldaniya
`,
);
console.log(`npm-dist/ ready: ${pkg.name}@${pkg.version}`);

