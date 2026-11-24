// airband_notes: what one chat leaves in this project for others. A note is a file a repository can
// carry, so what it says comes back fenced as data.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listNotes, readNote, saveNote } from "../core/notes";
import { data, text } from "./answer";

export function registerNotesTool(server: McpServer, root: string): void {
  server.registerTool(
    "airband_notes",
    {
      description: "Notes chats leave for this project. None: list. name: read one. title and text: save one (a handover).",
      inputSchema: {
        name: z.string().optional(),
        title: z.string().optional(),
        text: z.string().optional(),
      },
    },
    async ({ name, title, text: body }) => {
      if (title && body) {
        let saved: string;
        try {
          saved = saveNote(root, title, `# ${title}\n\n${body.trim()}`);
        } catch (err) {
          return text(err instanceof Error ? err.message : String(err), true);
        }
        return text(`Saved as ${saved}. Other chats can read it with airband_notes.`);
      }
      if (name) {
        const note = readNote(root, name);
        if (note === undefined) return text(`No note called ${name}. Call airband_notes with nothing to see the names.`, true);
        return data(note, `a note saved in this project's .airband/notes, which anyone who can change the repository can write`);
      }
      const notes = listNotes(root);
      return text(
        notes.length
          ? notes.map((x) => `${x.name} — ${x.title} (${new Date(x.at).toISOString().slice(0, 16).replace("T", " ")})`).join("\n")
          : "No notes yet in this project.",
      );
    },
  );
}
