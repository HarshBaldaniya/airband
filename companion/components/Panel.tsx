// The companion's panel, kept short: one line on how things stand, the ask box, the cards that
// need you, and the chats in three short lists. The settings sit behind the gear. The phone page
// is this panel, full screen, without the settings (those change on the computer only).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ExternalLink, MessageSquare, Send, Settings as Gear, X } from "lucide-react";
import { api, desktop, MODE, onAppUpdate, type AppUpdate, type DesktopPrefs, type LiveChat, type StationState } from "../api";
import { CompanionMark } from "../figure/Companion";
import { sounds } from "../sound";
import { AgentMark, ago, FinishedCard, RequestCard } from "./Cards";


/** Typing (ask, tell a chat) is on the computer only. The phone link answers requests and shows
 *  what finished: nothing typed on a phone reaches a chat. */
const TYPING = MODE === "desktop";

function ChatRow({ chat, onSay }: { chat: LiveChat; onSay: (t: string) => void }) {
  const c = chat;
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const send = async () => {
    if (!text.trim()) return;
    try {
      const r = await api.tell(c.id, text.trim());
      onSay(`Sent to "${r.title}". ${r.when ?? "It gets your message with its next turn."}`);
      setText("");
      setWriting(false);
    } catch (e) {
      onSay(e instanceof Error ? e.message : String(e));
    }
  };
  const waiting = c.status === "waiting" && c.line;
  const STATUS = { waiting: "Needs you", working: "Working", done: "Done", idle: "Quiet" } as const;
  return (
    <li className={`chat ${c.status}${writing ? " open" : ""}`}>
      <div className="chatline">
        <span className="chatavatar" title={STATUS[c.status]}>
          <AgentMark agent={c.agent} size={16} />
          <span className={`statusdot ${c.status}`} aria-label={STATUS[c.status]} />
        </span>
        <span className="chattext">
          <b className="ellipsis">{c.title}</b>
          <span className={`chatmeta ellipsis${waiting ? " waiting" : ""}`}>{waiting ? c.line : `${c.project} · ${ago(c.since)}`}</span>
        </span>
        <span className="rowactions">
          {/* Only a working chat takes a message straight away (its hook hands it over after the next
              step, or as it stops); any other would hold it until someone types there. */}
          {TYPING && c.status === "working" && (
            <button className="iconbtn" onClick={() => setWriting(!writing)} aria-label={`Message ${c.title}`} title="Message this chat">
              <MessageSquare size={14} />
            </button>
          )}
          <button className="iconbtn" onClick={() => (sounds.tick(), void api.open(c.id))} aria-label={`Open ${c.title}`} title={TYPING ? "Open this chat" : "Open it on your computer"}>
            <ExternalLink size={14} />
          </button>
        </span>
      </div>
      {TYPING && writing && c.status === "working" && (
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

/** A few things to ask with one click, when nothing else is showing. */
const QUICK = [
  { label: "What's happening?", ask: "what's happening?" },
  { label: "What did I do today?", ask: "what did I do today?" },
  { label: "Tell me a joke", ask: "tell me a joke" },
];

function QuickAsks({ name, onAsk }: { name: string; onAsk: (q: string) => void }) {
  return (
    <div className="quickasks" role="group" aria-label={`Ask ${name}`}>
      {QUICK.map((q) => (
        <button key={q.ask} className="chip" onClick={() => (sounds.tick(), onAsk(q.ask))}>
          {q.label}
        </button>
      ))}
    </div>
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

/** One setting: a title, one short line under it, and its switch. Every row is the same shape. */
function SettingRow({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="setrow">
      <span className="setlabel">
        {title}
        <small className="muted">{note}</small>
      </span>
      {children}
    </div>
  );
}

/** A QR code for a link, as an image address, drawn on the screen itself. */
const qrImage = (url: string, width: number) => import("qrcode").then((m) => m.toDataURL(url, { margin: 1, width }));

/** Link your iPhone through Airband's relay: a code that works once, then which iPhone holds the link. */
function PhoneRow({ state }: { state: StationState }) {
  const l = state.link;
  const [url, setUrl] = useState<string>();
  const [qr, setQr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const waiting = !!l?.codeUntil;
  // A code is showing: fetch it (the panel may have opened after Link), and count down.
  useEffect(() => {
    if (!waiting) return setUrl(undefined);
    if (!url) void api.phoneCode().then((r) => setUrl(r.url));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting, url]);
  useEffect(() => {
    if (!url) return setQr(undefined);
    void qrImage(url, 264).then(setQr);
  }, [url]);
  // Test: a pretend request goes to the iPhone at once; the line below says what happened.
  const [sent, setSent] = useState<{ at: number; text: string; ok: boolean }>();
  if (!l) return null;
  const phone = l.phones[0];
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  const link = () => run(async () => setUrl((await api.linkPhone()).url));
  const unlink = () => run(async () => void (await api.unlinkPhone(), setUrl(undefined), setSent(undefined)));
  const test = () =>
    run(async () => {
      const at = Date.now();
      try {
        const { results } = await api.testPhone();
        const bad = results.find((r) => !r.ok);
        setSent({ at, ok: !bad && results.length > 0, text: !results.length ? "Alerts aren't on yet. On the iPhone, open Airband and tap Turn on alerts." : bad ? bad.why ?? "It didn't go through." : `Sent to your ${phone?.name ?? "iPhone"}. Tap Allow or Deny there.` });
      } catch (e) {
        setSent({ at, ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    });
  const answered = sent && state.test && state.test.at >= sent.at ? state.test : undefined;
  const result = !sent
    ? undefined
    : answered
      ? answered.answer === "none"
        ? { ok: false, text: "Nobody answered in 90 seconds." }
        : { ok: true, text: `${answered.from === "phone" ? `Your ${phone?.name ?? "iPhone"}` : "You, on this Mac,"} answered: ${answered.answer === "deny" ? "Deny" : answered.answer === "always" ? "Always" : "Allow"}. It works.` }
      : sent;
  const left = waiting ? Math.max(0, Math.round((l.codeUntil! - now) / 1000)) : 0;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const note = phone
    ? `${phone.name} linked${phone.alerts ? ", alerts on" : ". Turn on alerts on the iPhone"}.`
    : waiting
      ? `Scan with your iPhone's camera. Works once, ${clock} left.`
      : l.expired
        ? "The code ran out. Click Link for a new one."
        : "Requests on your iPhone, from anywhere.";
  return (
    <>
      <SettingRow title="Your phone" note={note}>
        {phone ? (
          <span className="rowbtns">
            {phone.alerts && (
              <button className="btn small" disabled={busy} onClick={() => void test()} title="Send a pretend request to your iPhone">
                Test
              </button>
            )}
            <button className="btn small" disabled={busy} onClick={() => void unlink()}>
              Unlink
            </button>
          </span>
        ) : waiting ? (
          <button className="btn small" disabled={busy} onClick={() => void unlink()}>
            Cancel
          </button>
        ) : (
          <button className="btn small primary" disabled={busy} onClick={() => void link()}>
            Link
          </button>
        )}
      </SettingRow>
      {(phone || waiting) && !l.online && <p className="testline bad">Can't reach Airband's relay. Trying again…</p>}
      {phone && (
        <SettingRow title="Alert my phone always" note="Also while you're at this Mac.">
          <Toggle on={state.settings.phoneAlways} label="Alert my phone always" onChange={(on) => api.settings({ phoneAlways: on })} />
        </SettingRow>
      )}
      {result && (
        <p className={`testline${result.ok ? " ok" : " bad"}`} role="status">
          {result.text}
        </p>
      )}
      <div className={`phonelink${waiting && url ? " open" : ""}`}>
        <div className="phoneinner">
          {qr ? <img src={qr} alt="Code to link your iPhone" width={132} height={132} /> : url && <code className="linkurl">{url}</code>}
          <ol className="linksteps muted">
            <li>Scan with your iPhone's camera.</li>
            <li>Share, then Add to Home Screen.</li>
            <li>Open Airband there. It links by itself.</li>
          </ol>
        </div>
      </div>
    </>
  );
}

function SettingsView({ state, prefs, onPref }: { state: StationState; prefs?: DesktopPrefs; onPref: (k: keyof DesktopPrefs, on: boolean) => void }) {
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
      <PhoneRow state={state} />
      <p className="privacy muted">Sees your chats' records only. Never your files, folders or screen.</p>
      <p className="foot muted">
        {state.settings.companion.name}, from Airband {state.version}
      </p>
    </section>
  );
}

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
/** "Airband 0.1.2 is ready · Update": one click updates the app and starts it again. While it
 *  runs, the bar fills with the download, then says it is installing and starting again. */
function UpdateBar() {
  const [u, setU] = useState<AppUpdate>();
  useEffect(() => onAppUpdate(setU), []);
  if (!u?.version) return null;
  const pct = u.installing && u.step === "downloading" ? u.progress : undefined;
  const say = u.error
    ? u.error
    : !u.installing
      ? `Airband ${u.version} is ready`
      : u.step === "installing"
        ? `Installing Airband ${u.version}…`
        : u.step === "restarting"
          ? "Starting again. I'll be right back."
          : `Downloading Airband ${u.version}${pct != null ? ` · ${pct}%` : "…"}`;
  return (
    <div className={`updatebar${u.installing ? " busy" : ""}`} role="status">
      {u.installing && <span className="fill" style={{ width: `${u.step === "downloading" ? (pct ?? 4) : 100}%` }} />}
      <span className="ellipsis">{say}</span>
      {u.installing ? (
        <span className="spin" aria-hidden />
      ) : (
        <button className="btn primary small" onClick={() => (sounds.tick(), desktop?.installUpdate?.())}>
          {u.error ? "Try again" : "Update"}
        </button>
      )}
    </div>
  );
}

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
