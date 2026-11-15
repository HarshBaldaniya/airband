// What changed, from the CHANGELOG.md built into this copy: shown after an update and by
// `airband changelog`. No network: the notes travel with the version they describe.
import changelog from "../../CHANGELOG.md";
import { newer } from "../core/setup";

export interface Release {
  version: string;
  notes: string;
}

/** Every release in the changelog, newest first ("## Unreleased" is left out). */
export function releases(text = changelog): Release[] {
  const out: Release[] = [];
  const parts = text.split(/^## /m).slice(1);
  for (const p of parts) {
    const [head, ...body] = p.split("\n");
    const version = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(head.trim())?.[1];
    if (version) out.push({ version, notes: body.join("\n").trim() });
  }
  return out;
}

/** The releases newer than `from`, up to and including `to`. */
export function changesSince(from: string, to: string, text = changelog): Release[] {
  return releases(text).filter((r) => newer(r.version, from) && !newer(r.version, to));
}
