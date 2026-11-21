// The companion's panel, kept short: one line on how things stand, the ask box, the cards that
// need you, and the chats in three short lists. The settings sit behind the gear. The phone page
// is this panel, full screen, without the settings (those change on the computer only).
import { useEffect, useRef, useState } from "react";
import { ExternalLink, MessageSquare, Send, Settings as Gear, X } from "lucide-react";
import { api, desktop, MODE, type DesktopPrefs, type LiveChat, type StationState } from "../api";
import { CompanionMark } from "../companion/Companion";
import { DESIGNS } from "../companion/designs";
import { AgentMark, ago, FinishedCard, RequestCard } from "./Cards";

const GROUPS: { status: LiveChat["status"]; title: string }[] = [
  { status: "waiting", title: "Needs you" },
  { status: "working", title: "Working" },
  { status: "done", title: "Finished today" },
];
const PER_GROUP = 5;

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

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function SettingsView({ state, onSay }: { state: StationState; onSay: (t: string) => void }) {
  const s = state.settings;
  const [prefs, setPrefs] = useState<DesktopPrefs>();
  const [qr, setQr] = useState<string>();
  const [name, setName] = useState(s.companion.name);
  useEffect(() => void desktop?.prefs().then(setPrefs), []);
  useEffect(() => {
    if (state.phoneUrl) void desktop?.qr(state.phoneUrl).then(setQr);
    else setQr(undefined);
  }, [state.phoneUrl]);
  const saveName = () => {
    if (name.trim() && name.trim() !== s.companion.name) void api.settings({ companionName: name.trim() });
  };
  const pref = (k: keyof DesktopPrefs, on: boolean) => {
    desktop?.setPref(k, on);
    setPrefs((p) => (p ? { ...p, [k]: on } : p));
  };
  return (
    <section className="settings">
      <label className="setrow" htmlFor="companion-name">
        <span>Name</span>
        <input id="companion-name" className="nameinput" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
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
        <Toggle on={s.approvals} label="Answer requests here" onChange={(on) => void api.settings({ approvals: on })} />
      </div>
      <div className="setrow">
        <span className="setlabel">
          Look things up
          <small className="muted">Lets {s.companion.name} ask Claude Code about your chats. Airband's records only.</small>
        </span>
        <Toggle on={s.lookups} label="Look things up" onChange={(on) => void api.settings({ lookups: on })} />
      </div>
      {prefs && (
        <div className="setrow">
          <span>Sounds</span>
          <Toggle on={prefs.sound} label="Sounds" onChange={(on) => pref("sound", on)} />
        </div>
      )}
      <div className="setrow">
        <span>Phone link</span>
        <Toggle on={s.phone} label="Phone link" onChange={(on) => void api.settings({ phone: on }).then((r) => onSay(r.phone ? "Scan the code with your phone's camera. Same Wi-Fi only." : "Phone link off."))} />
      </div>
      {s.phone && qr && (
        <div className="phone">
          <img src={qr} alt="QR code for the phone page" width={132} height={132} />
          <span className="muted">Scan with your phone's camera, then Share › Add to Home Screen.</span>
        </div>
      )}
      <p className="privacy muted">{s.companion.name} sees your chats' records in Airband and nothing else: no files, folders or screen.</p>
      <p className="foot muted">Airband {state.version}</p>
    </section>
  );
}

export function Panel({ state, name, design, onClose, onAsk, asking, onSay, onError, showSettings }: { state: StationState; name: string; design?: string; onClose?: () => void; onAsk: (q: string) => void; asking: boolean; onSay: (t: string) => void; onError: (m: string) => void; showSettings?: boolean }) {
  const [settings, setSettings] = useState(!!showSettings);
  useEffect(() => setSettings(!!showSettings), [showSettings]);
  const start = new Date(state.now);
  start.setHours(0, 0, 0, 0);
  // A chat whose request is on a card above is not listed again.
  const carded = new Set(state.pending.map((p) => p.chatId).filter(Boolean));
  const shown = state.chats.filter((c) => c.status !== "idle" && !carded.has(c.id) && (c.status !== "done" || c.since >= start.getTime()));
  const canSet = MODE === "desktop";
  return (
    <div className="panel" data-hit>
      <div className="panelhead">
        <CompanionMark design={design} size={26} />
        <div className="panelhead-text">
          <b>{settings ? "Settings" : name}</b>
          {!settings && <span className="muted">{state.headline}</span>}
        </div>
        {canSet && (
          <button className={`iconbtn${settings ? " on" : ""}`} onClick={() => setSettings(!settings)} aria-label="Settings" aria-pressed={settings}>
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
        <SettingsView state={state} onSay={onSay} />
      ) : (
        <>
          <AskBox name={name} onAsk={onAsk} busy={asking} />
          {state.pending.map((p) => (
            <RequestCard key={p.id} request={p} onError={onError} />
          ))}
          {MODE === "phone" && state.finished.slice(0, 3).map((f) => <FinishedCard key={`${f.chatId}:${f.at}`} finished={f} onSay={onSay} />)}
          {GROUPS.map((g) => {
            const list = shown.filter((c) => c.status === g.status);
            if (!list.length) return null;
            return (
              <section key={g.title} className="group">
                <h3>
                  {g.title} <span className="muted">{list.length}</span>
                </h3>
                <ul className="chats">
                  {list.slice(0, PER_GROUP).map((c) => (
                    <ChatRow key={c.id} chat={c} onSay={onSay} />
                  ))}
                </ul>
              </section>
            );
          })}
          {!shown.length && !state.pending.length && <p className="muted empty">Nothing going on. Start a chat in Claude Code, Codex or Gemini CLI and {name} sees it.</p>}
        </>
      )}
    </div>
  );
}
