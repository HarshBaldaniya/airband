// The companion's identity: what it is called and how it looks. Both are settings, kept with the
// Station's other settings, so a person can rename it or pick another design, and a new default
// is one line here. Nothing else in the code depends on either.
export interface CompanionSettings {
  /** What the companion is called on screen ("Ask Roger…"). */
  name: string;
  /** Which look it has: an id from the app's list of designs. */
  design: string;
}

export const DEFAULT_COMPANION: CompanionSettings = { name: "Roger", design: "headset" };
const NAME_MAX = 24;

/** A name fit to show: trimmed, short, never empty. */
export function cleanName(name: unknown): string {
  const n = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
  return n || DEFAULT_COMPANION.name;
}

/** A design id fit to keep: letters, digits and dashes. The app falls back to its default for one it doesn't know. */
export function cleanDesign(design: unknown): string {
  return typeof design === "string" && /^[a-z0-9-]{1,32}$/.test(design) ? design : DEFAULT_COMPANION.design;
}
