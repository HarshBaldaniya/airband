// Reading the JSON files Airband and the agents keep: whole files, and JSON lines (one object a line,
// appended as things happen). A file or line that doesn't parse is never an error: a file that isn't
// there yet reads as the fallback, and a line cut short by a crash is skipped.
import * as fs from "node:fs";

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** One line of a JSON lines file, or undefined when it is blank or torn. */
export function parseJsonLine<T>(line: string): T | undefined {
  if (!line.trim()) return undefined;
  try {
    return JSON.parse(line) as T;
  } catch {
    return undefined;
  }
}

/** Every whole line of a JSON lines text. */
export function parseJsonLines<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const v = parseJsonLine<T>(line);
    if (v !== undefined) out.push(v);
  }
  return out;
}
