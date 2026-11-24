// The companion's panel, kept short: one line on how things stand, the ask box, the cards that
// need you, and the chats in three short lists. The settings sit behind the gear. The phone page
// is this panel, full screen, without the settings (those change on the computer only).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Settings as Gear, X } from "lucide-react";
import { MODE, type DesktopPrefs } from "../../api/desktop-bridge";
import type { LiveChat, StationState } from "../../api/station";
import { CompanionMark } from "../../figure/Companion";
import { sounds } from "../../sound";
import { FinishedCard } from "../cards/FinishedCard";
import { RequestCard } from "../cards/RequestCard";
import { SettingsView } from "../settings/SettingsView";
import { AskBox } from "./AskBox";
import { ChatRow } from "./ChatRow";
import { QuickAsks } from "./QuickAsks";
import { TYPING } from "./typing";
import { UpdateBar } from "./UpdateBar";

type Tab = "waiting" | "working" | "done";

/** A tab's chats in title order, so rows stay put as they update (numbers in order: 2 before 10). */
const byTitle = <T extends { title: string; id: string }>(chats: T[]) =>
  [...chats].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id));
const TABS: { id: Tab; title: string }[] = [
  { id: "waiting", title: "Needs you" },
  { id: "working", title: "Working" },
  { id: "done", title: "Done" },
];

export interface PanelProps {
  state: StationState;
  name: string;
  design?: string;
  onClose?: () => void;
  /** The ask box: shown only when given (on the computer). */
  onAsk?: (q: string) => void;
  asking?: boolean;
  onSay: (t: string) => void;
  onError: (m: string) => void;
  showSettings?: boolean;
  prefs?: DesktopPrefs;
  onPref?: (k: keyof DesktopPrefs, on: boolean) => void;
  /** The companion's latest answer, shown at the top of the panel. */
  answer?: ReactNode;
  /** An answer or a question is showing: the quick asks step aside. */
  hasAnswer?: boolean;
}

/**
 * The panel: a fixed top (who, how things stand, the ask box, the tabs) and one short list that
 * scrolls. However many chats run, it stays the same size, one tab at a time.
 */
export function Panel({ state, name, design, onClose, onAsk, asking, onSay, onError, showSettings, prefs, onPref, answer, hasAnswer }: PanelProps) {
  const [settings, setSettings] = useState(!!showSettings);
  useEffect(() => setSettings(!!showSettings), [showSettings]);
  const start = new Date(state.now);
  start.setHours(0, 0, 0, 0);
  // A chat whose request is on a card is not listed again.
  const carded = new Set(state.pending.map((p) => p.chatId).filter(Boolean));
  const lists: Record<Tab, LiveChat[]> = {
    waiting: byTitle(state.chats.filter((c) => c.status === "waiting" && !carded.has(c.id))),
    working: byTitle(state.chats.filter((c) => c.status === "working")),
    done: byTitle(state.chats.filter((c) => c.status === "done" && c.since >= start.getTime())),
  };
  const first = (TABS.find((t) => lists[t.id].length)?.id ?? "working") as Tab;
  const [tab, setTab] = useState<Tab>(first);
  // Follow the most urgent tab until the person picks one.
  const picked = useRef(false);
  useEffect(() => {
    if (!picked.current) setTab(first);
  }, [first]);
  const compact = state.pending.length > 1;
  const canSet = MODE === "desktop";
  const list = lists[tab];
  const anyChats = TABS.some((t) => lists[t.id].length);
  return (
    <div className="panel" data-hit>
      <div className="panelhead">
        <CompanionMark design={design} size={26} />
        <div className="panelhead-text">
          <b>{settings ? "Settings" : name}</b>
          {!settings && <span className="muted ellipsis">{state.headline}</span>}
        </div>
        {canSet && (
          <button className={`iconbtn${settings ? " on" : ""}`} onClick={() => (sounds.tick(), setSettings(!settings))} aria-label="Settings" aria-pressed={settings}>
            <Gear size={15} />
          </button>
        )}
        {onClose && (
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        )}
      </div>
      {canSet && <UpdateBar />}
      {settings && canSet ? (
        <div className="panelscroll panelbody" key="settings">
          <SettingsView state={state} prefs={prefs} onPref={onPref ?? (() => undefined)} />
        </div>
      ) : (
        <>
          {TYPING && onAsk && <AskBox name={name} onAsk={onAsk} busy={!!asking} />}
          {TYPING && onAsk && !asking && !hasAnswer && <QuickAsks name={name} onAsk={onAsk} />}
          {answer}
          {!!state.pending.length && (
            <div className={`requests${compact ? " compact" : ""}`}>
              {state.pending.map((p) => (
                <RequestCard key={p.id} request={p} onError={onError} compact={compact} />
              ))}
            </div>
          )}
          {MODE === "phone" && state.finished.slice(0, 2).map((f) => <FinishedCard key={`${f.chatId}:${f.at}`} finished={f} />)}
          {anyChats ? (
            <>
              <div className="tabs" role="tablist">
                {TABS.map((t) => (
                  <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? " on" : ""}`} onClick={() => ((picked.current = true), setTab(t.id))}>
                    {t.title}
                    <span className="count">{lists[t.id].length}</span>
                  </button>
                ))}
              </div>
              <div className="panelscroll panelbody" key={tab}>
                {list.length ? (
                  <ul className="chats">
                    {list.map((c) => (
                      <ChatRow key={c.id} chat={c} onSay={onSay} />
                    ))}
                  </ul>
                ) : (
                  <p className="muted empty">{tab === "waiting" ? "Nothing needs you." : tab === "working" ? "No chat is working." : "Nothing finished yet today."}</p>
                )}
              </div>
            </>
          ) : (
            !state.pending.length && <p className="muted empty">Nothing going on. Start a chat in Claude Code, Codex or Gemini CLI and {name} sees it.</p>
          )}
        </>
      )}
    </div>
  );
}
