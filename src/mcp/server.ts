// Airband's tools for any AI tool that speaks MCP (Claude Code, Codex, Cursor, Gemini CLI ...):
// the code map, the flightlogs of every chat on this computer, and notes. Three tools on purpose:
// every tool's definition is paid for in every chat, used or not, so they are few and short.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "../core/version";
import { registerFlightlogTool } from "./flightlog-tool";
import { offerLibrary } from "./library-prompts";
import { registerMapTool } from "./map-tool";
import { registerNotesTool } from "./notes-tool";

// Shown to the agent at the start of every session, so it reaches for Airband without being told.
// Short on purpose (the agent reads it in every chat); the most useful line first.
const INSTRUCTIONS = [
  "Airband gives this project a map of its code and the records of the person's other AI chats on this computer.",
  "- To find code (where something is defined, what calls or imports it, how a folder is laid out), call airband_map before grep, glob or reading whole files: find for a name or plain words, outline for a file or folder, graph for who uses what, no arguments for an overview. It answers in a few hundred tokens.",
  "- To review a branch or pull request, call airband_map with diff first (\"main..feature\", a branch, or \"#128\"): what it changed, who calls each change and which tests reach it, without checking it out. Add in to ask another project the person mapped (\"my-api\").",
  "- When the person refers to earlier work or another chat (what was done, which chat changed something, what happened while they were away, a ticket like ENG-142, a PR like #128), call airband_flightlog: with query to search every chat, or with chat to read one.",
  "- airband_notes holds notes chats left for this project; read them before working in an unfamiliar area, and save one when you learn something the next chat should know.",
].join("\n");

/** The MCP server for the project at `root`, with its tools and the Library's prompts. `stop` ends
 *  the watch on the person's own commands. */
export function createServer(root: string): { server: McpServer; stop: () => void } {
  const server = new McpServer({ name: "airband", version: VERSION }, { instructions: INSTRUCTIONS });
  registerMapTool(server, root);
  registerFlightlogTool(server, root);
  registerNotesTool(server, root);
  const stop = offerLibrary(server);
  return { server, stop };
}
