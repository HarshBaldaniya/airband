// The companion's settings, behind the gear on the computer: requests, look-ups, sounds and the
// phone link.
import type { DesktopPrefs } from "../../api/desktop-bridge";
import { api, type StationState } from "../../api/station";
import { PhoneLinkRow } from "./PhoneLinkRow";
import { SettingRow } from "./SettingRow";
import { Toggle } from "./Toggle";

export function SettingsView({ state, prefs, onPref }: { state: StationState; prefs?: DesktopPrefs; onPref: (k: keyof DesktopPrefs, on: boolean) => void }) {
  const s = state.settings;
  return (
    <section className="settings">
      <SettingRow title="Answer requests here" note="Allow or deny from this corner.">
        <Toggle on={s.approvals} label="Answer requests here" onChange={(on) => api.settings({ approvals: on })} />
      </SettingRow>
      <SettingRow title="Look things up" note="Answers from your chats' records.">
        <Toggle on={s.lookups} label="Look things up" onChange={(on) => api.settings({ lookups: on })} />
      </SettingRow>
      {prefs && (
        <SettingRow title="Sounds" note="Soft sounds for requests and replies.">
          <Toggle on={prefs.sound} label="Sounds" onChange={(on) => onPref("sound", on)} />
        </SettingRow>
      )}
      <PhoneLinkRow state={state} />
      <p className="privacy muted">Sees your chats' records only. Never your files, folders or screen.</p>
      <p className="foot muted">
        {state.settings.companion.name}, from Airband {state.version}
      </p>
    </section>
  );
}
