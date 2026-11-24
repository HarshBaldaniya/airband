// After an agent writes a doc file: what in the new text breaks the docs rules.
import * as fs from "node:fs";
import { checkWriting, type WritingFinding } from "./check";

const DOC_FILE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
const NOT_DOCS = /(^|[\\/])(node_modules|\.git|dist|build|vendor)[\\/]|(^|[\\/])(LICEN[CS]E|NOTICE|CODEOWNERS)(\.\w+)?$|\.(lock|min)\./i;

/** What an agent's write or edit put in a doc file: the file and the new text. */
export function writtenDoc(toolName: string | undefined, input: unknown): { file: string; text: string } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const file = typeof i.file_path === "string" ? i.file_path : typeof i.absolute_path === "string" ? i.absolute_path : typeof i.path === "string" ? i.path : undefined;
  if (!file || !DOC_FILE.test(file) || NOT_DOCS.test(file)) return undefined;
  const name = toolName ?? "";
  let text: string | undefined;
  if (/^(Write|write_file)$/.test(name)) text = typeof i.content === "string" ? i.content : undefined;
  else if (/^(Edit|replace)$/.test(name)) text = typeof i.new_string === "string" ? i.new_string : undefined;
  else if (name === "MultiEdit" && Array.isArray(i.edits)) text = (i.edits as { new_string?: unknown }[]).map((e) => (typeof e.new_string === "string" ? e.new_string : "")).join("\n\n");
  return text?.trim() ? { file, text } : undefined;
}

/** The check of a doc just written, with lines counted in the file itself where the text is found. */
export function checkWrittenDoc(doc: { file: string; text: string }): WritingFinding[] {
  const found = checkWriting(doc.text, "docs");
  if (!found.length) return found;
  let offset = 0;
  try {
    const whole = fs.readFileSync(doc.file, "utf8");
    const at = whole.indexOf(doc.text.split("\n").find((l) => l.trim().length > 8) ?? doc.text);
    const firstLong = doc.text.split("\n").findIndex((l) => l.trim().length > 8);
    if (at >= 0) offset = whole.slice(0, at).split("\n").length - 1 - Math.max(0, firstLong);
  } catch {
    // The file is gone already: lines of the text itself.
  }
  return found.map((f) => ({ ...f, line: f.line + offset }));
}
