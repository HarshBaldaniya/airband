// The MCP server's entry point: agents start dist/airband-mcp.js in the chat's folder (or with
// AIRBAND_ROOT) and talk to it over stdio. Only this file runs anything when loaded.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

const { server } = createServer(process.env.AIRBAND_ROOT || process.cwd());
server.connect(new StdioServerTransport()).catch((err) => {
  console.error("airband-mcp:", err);
  process.exit(1);
});
