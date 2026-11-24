// The Station's settings, kept in ~/.airband/station-settings.json: whether requests come to the
// app, how long they wait, the companion's name and look, look-ups, and the phone's alerts.
import { airbandFile, writeFileAtomic } from "../core/paths";
import { readJson } from "../core/json";
import { DECISION_MS } from "./client";
import { cleanDesign, cleanName, DEFAULT_COMPANION } from "./companion";
import type { StationSettings } from "./types";

const settingsFile = () => airbandFile("station-settings.json");

/** The shortest wait a request may be given before the terminal asks. */
export const WAIT_MIN_MS = 5000;

const defaultSettings = (): StationSettings => ({ approvals: true, waitMs: DECISION_MS, companion: { ...DEFAULT_COMPANION }, lookups: true, phoneAlways: true });

export function readSettings(): StationSettings {
  // "phone" was the network phone link, gone since the relay: an old file's value is dropped.
  const { phone: _phone, ...saved } = readJson<Partial<StationSettings> & { phone?: unknown }>(settingsFile(), {});
  return { ...defaultSettings(), ...saved, companion: { name: cleanName(saved.companion?.name), design: cleanDesign(saved.companion?.design) } };
}

export function saveSettings(s: StationSettings): void {
  writeFileAtomic(settingsFile(), JSON.stringify(s));
}

/** The settings a screen asked to change, each checked: anything else in `body` is ignored. */
export function settingsPatch(body: Record<string, unknown>, current: StationSettings): Partial<StationSettings> {
  const patch: Partial<StationSettings> = {};
  if (typeof body.approvals === "boolean") patch.approvals = body.approvals;
  if (typeof body.lookups === "boolean") patch.lookups = body.lookups;
  if (typeof body.phoneAlways === "boolean") patch.phoneAlways = body.phoneAlways;
  if (typeof body.waitMs === "number") patch.waitMs = Math.max(WAIT_MIN_MS, Math.min(body.waitMs, DECISION_MS));
  if (body.companionName !== undefined || body.companionDesign !== undefined)
    patch.companion = { name: body.companionName !== undefined ? cleanName(body.companionName) : current.companion.name, design: body.companionDesign !== undefined ? cleanDesign(body.companionDesign) : current.companion.design };
  return patch;
}
