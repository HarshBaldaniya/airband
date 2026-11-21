// The companion's panel, kept short: one line on how things stand, the ask box, the cards that
// need you, and the chats in three short lists. The settings sit behind the gear. The phone page
// is this panel, full screen, without the settings (those change on the computer only).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ExternalLink, MessageSquare, Send, Settings as Gear, X } from "lucide-react";
import { api, desktop, MODE, type DesktopPrefs, type LiveChat, type StationState } from "../api";
import { CompanionMark } from "../companion/Companion";
import { DESIGNS } from "../companion/designs";
import { sounds } from "../sound";
import { AgentMark, ago, FinishedCard, RequestCard } from "./Cards";


function ChatRow({ chat, onSay }: { chat: LiveChat; onSay: (t: string) => void }) {
  const c = chat;
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const send = async () => {
    if (!text.trim()) return;
    try {
      const r = await api.tell(c.id, text.trim());
      onSay(`Sent to "${r.title}". It gets your message with its next turn.`);
      setText("");
      setWriting(false);
    } catch (e) {
      onSay(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <li className={`chat ${c.status}`}>
      <div className="chatline">
        <span className={`dot ${c.status}`} />
        <AgentMark agent={c.agent} />
        <span className="chattext">
          <b className="ellipsis">{c.title}</b>
          <span className="muted ellipsis">{c.status === "waiting" && c.line ? c.line : c.project}</span>
        </span>
        <span className="muted when">{ago(c.since)}</span>
        <span className="rowactions">
          <button className="iconbtn" onClick={() => setWriting(!writing)} aria-label={`Message ${c.title}`} title="Message this chat">
            <MessageSquare size={14} />
          </button>
          <button className="iconbtn" onClick={() => void api.open(c.id).then((r) => onSay(r.text))} aria-label={`Open ${c.title}`} title="Open this chat">
            <ExternalLink size={14} />
          </button>
        </span>
      </div>
      {writing && (
        <form
          className="tell"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr" htmlFor={`tell-${c.id}`}>
            Message for {c.title}
          </label>
          <input id={`tell-${c.id}`} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell this chat…" />
          <button className="btn primary" type="submit" disabled={!text.trim()} aria-label="Send">
            <Send size={14} />
          </button>
        </form>
      )}
    </li>
  );
}

export function AskBox({ name, onAsk, busy }: { name: string; onAsk: (q: string) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form
      className="ask"
      onSubmit={(e) => {
        e.preventDefault();
        if (!q.trim() || busy) return;
        onAsk(q.trim());
        setQ("");
      }}
    >
      <label className="sr" htmlFor="ask">
        Ask {name}
      </label>
      <input id="ask" ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder={busy ? `${name} is looking…` : `Ask ${name}…`} disabled={busy} />
      <button className="btn primary" type="submit" disabled={busy || !q.trim()} aria-label="Ask">
        <Send size={14} />
      </button>
    </form>
  );
}

type Saving = "idle" | "busy" | "done";

/** A switch that shows its own progress: a short pulse while it saves, then a check. No message. */
function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => Promise<unknown> | void }) {
  const [saving, setSaving] = useState<Saving>("idle");
  const [shown, setShown] = useState(on);
  useEffect(() => setShown(on), [on]);
  const flip = async () => {
    const next = !shown;
    setShown(next);
    (next ? sounds.on : sounds.off)();
    setSaving("busy");
    try {
      await onChange(next);
      setSaving("done");
      setTimeout(() => setSaving("idle"), 900);
    } catch {
      setShown(!next);
      setSaving("idle");
    }
  };
  return (
    <span className="togglewrap">
      <span className={`saved${saving === "done" ? " show" : ""}`} aria-hidden="true">
        <Check size={13} />
      </span>
      <button role="switch" aria-checked={shown} aria-label={label} aria-busy={saving === "busy"} className={`toggle${shown ? " on" : ""}${saving === "busy" ? " busy" : ""}`} onClick={() => void flip()}>
        <span />
      </button>
    </span>
  );
}

function SettingsView({ state, prefs, onPref }: { state: StationState; prefs?: DesktopPrefs; onPref: (k: keyof DesktopPrefs, on: boolean) => void }) {
  const s = state.settings;
  const [qr, setQr] = useState<string>();
  const [name, setName] = useState(s.companion.name);
  const [nameSaved, setNameSaved] = useState(false);
  useEffect(() => {
    if (state.phoneUrl) void desktop?.qr(state.phoneUrl).then(setQr);
  }, [state.phoneUrl]);
  const saveName = async () => {
    if (!name.trim() || name.trim() === s.companion.name) return;
    await api.settings({ companionName: name.trim() });
    sounds.tick();
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 1200);
  };
  return (
    <section className="settings">
      <label className="setrow" htmlFor="companion-name">
        <span>Name</span>
        <span className="togglewrap">
          <span className={`saved${nameSaved ? " show" : ""}`} aria-hidden="true">
            <Check size={13} />
          </span>
          <input id="companion-name" className="nameinput" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onBlur={() => void saveName()} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
        </span>
      </label>
      {DESIGNS.length > 1 && (
        <label className="setrow" htmlFor="companion-design">
          <span>Look</span>
          <select id="companion-design" value={s.companion.design} onChange={(e) => void api.settings({ companionDesign: e.target.value })}>
            {DESIGNS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="setrow">
        <span>Answer requests here</span>
        <Toggle on={s.approvals} label="Answer requests here" onChange={(on) => api.settings({ approvals: on })} />
      </div>
      <div className="setrow">
        <span className="setlabel">
          Look things up
          <small className="muted">Asks Claude Code, with Airband's records only.</small>
        </span>
        <Toggle on={s.lookups} label="Look things up" onChange={(on) => api.settings({ lookups: on })} />
      </div>
      {prefs && (
        <div className="setrow">
          <span>Sounds</span>
          <Toggle on={prefs.sound} label="Sounds" onChange={(on) => onPref("sound", on)} />
        </div>
      )}
      <div className="setrow">
        <span className="setlabel">
          Phone link
          <small className="muted">Same Wi-Fi only.</small>
        </span>
        <Toggle on={s.phone} label="Phone link" onChange={(on) => api.settings({ phone: on })} />
      </div>
      <div className={`phone${s.phone && qr ? " open" : ""}`}>
        <div className="phoneinner">
          {qr && <img src={qr} alt="QR code for the phone page" width={120} height={120} />}
          <span className="muted">Scan with your phone's camera.</span>
        </div>
      </div>
      <p className="privacy muted">Sees your chats' records only. Never your files, folders or screen.</p>
      <p className="foot muted">Airband {state.version}</p>
    </section>
  );
}

type Tab = "waiting" | "working" | "done";
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
  onAsk: (q: string) => void;
  asking: boolean;
  onSay: (t: string) => void;
  onError: (m: string) => void;
  showSettings?: boolean;
  prefs?: DesktopPrefs;
  onPref?: (k: keyof DesktopPrefs, on: boolean) => void;
  /** The companion's latest answer, shown at the top of the panel. */
  answer?: ReactNode;
}

/**
 * The panel: a fixed top (who, how things stand, the ask box, the tabs) and one short list that
 * scrolls. However many chats run, it stays the same size, one tab at a time.
 */
export function Panel({ state, name, design, onClose, onAsk, asking, onSay, onError, showSettings, prefs, onPref, answer }: PanelProps) {
  const [settings, setSettings] = useState(!!showSettings);
  useEffect(() => setSettings(!!showSettings), [showSettings]);
  const start = new Date(state.now);
  start.setHours(0, 0, 0, 0);
  // A chat whose request is on a card is not listed again.
  const carded = new Set(state.pending.map((p) => p.chatId).filter(Boolean));
  const lists: Record<Tab, LiveChat[]> = {
    waiting: state.chats.filter((c) => c.status === "waiting" && !carded.has(c.id)),
    working: state.chats.filter((c) => c.status === "working"),
    done: state.chats.filter((c) => c.status === "done" && c.since >= start.getTime()),
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
          <b>
            {settings ? "Settings" : name}
            {!settings && <span className="brand">Airband</span>}
          </b>
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
      {settings && canSet ? (
        <div className="panelscroll panelbody" key="settings">
          <SettingsView state={state} prefs={prefs} onPref={onPref ?? (() => undefined)} />
        </div>
      ) : (
        <>
          <AskBox name={name} onAsk={onAsk} busy={asking} />
          {answer}
          {!!state.pending.length && (
            <div className={`requests${compact ? " compact" : ""}`}>
              {state.pending.map((p) => (
                <RequestCard key={p.id} request={p} onError={onError} compact={compact} />
              ))}
            </div>
          )}
          {MODE === "phone" && state.finished.slice(0, 2).map((f) => <FinishedCard key={`${f.chatId}:${f.at}`} finished={f} onSay={onSay} />)}
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
