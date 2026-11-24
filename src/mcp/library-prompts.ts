// The Library as slash commands: Airband's commands and the person's own, offered as MCP prompts.
// The person's own are live: a saved file is offered within a few seconds.
import * as fs from "node:fs";
import * as path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { allCommands, renderCommand, userLibraryDir, type LibraryCommand } from "../library/index";

/** How often the person's own commands are looked at for changes. */
const LIBRARY_EVERY_MS = 3000;

type Registered = ReturnType<McpServer["registerPrompt"]>;

function promptKey(c: LibraryCommand): string {
  return `${c.source}\0${c.description}\0${c.body}\0${c.args.map((a) => `${a.name}${a.required ? "*" : ""}`).join(",")}`;
}

/** Offers every command as an MCP prompt; run again, it adds, updates and removes what changed. */
function syncPrompts(server: McpServer, prompts: Map<string, { reg: Registered; key: string }>): void {
  const commands = allCommands();
  const seen = new Set<string>();
  for (const c of commands) {
    seen.add(c.name);
    const key = promptKey(c);
    const had = prompts.get(c.name);
    if (had && had.key === key) continue;
    had?.reg.remove();
    const argsSchema: Record<string, z.ZodTypeAny> = {};
    for (const a of c.args) argsSchema[a.name] = a.required ? z.string().describe(a.description) : z.string().optional().describe(a.description);
    const reg = server.registerPrompt(
      c.name,
      { title: c.title, description: c.needs ? `${c.description} (needs ${c.needs} connected)` : c.description, argsSchema },
      (values: Record<string, unknown>) => ({
        messages: [{ role: "user" as const, content: { type: "text" as const, text: renderCommand(c, values as Record<string, string | undefined>) } }],
      }),
    );
    prompts.set(c.name, { reg, key });
  }
  for (const [name, p] of prompts) {
    if (!seen.has(name)) {
      p.reg.remove();
      prompts.delete(name);
    }
  }
}


/** Offers every command now, and again whenever the person's own commands change. */
export function offerLibrary(server: McpServer): () => void {
  const prompts = new Map<string, { reg: Registered; key: string }>();
  syncPrompts(server, prompts);
  let libraryStamp = "";
  const timer = setInterval(() => {
    let stamp = "";
    try {
      const dir = userLibraryDir();
      for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) {
        if (!f.endsWith(".md")) continue;
        const st = fs.statSync(path.join(dir, f));
        stamp += `${f}:${st.mtimeMs}:${st.size};`;
      }
    } catch {
      // No library folder: only the shipped commands.
    }
    if (stamp !== libraryStamp) {
      const first = libraryStamp === "" && stamp === "";
      libraryStamp = stamp;
      if (!first) syncPrompts(server, prompts);
    }
  }, LIBRARY_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
