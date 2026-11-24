// The desktop corner: the companion, and next to it the cards that need you or its panel. The
// window keeps one size and lets clicks through everywhere except on what it draws, so opening the
// panel never moves or redraws the companion. Drag it anywhere; tuck it away small; right-click it
// for the app's menu.
import { useCallback, useEffect, useRef, useState } from "react";
import { Minus } from "lucide-react";
import { desktop, onCommand, onCursor, onPlace, onPointer, onPrefs, type DesktopPrefs, type Place } from "../api/desktop-bridge";
import type { FinishedView } from "../api/station";
import { Conversation } from "../components/cards/Conversation";
import { FinishedToast } from "../components/cards/FinishedCard";
import { RequestCard } from "../components/cards/RequestCard";
import { Panel } from "../components/panel/Panel";
import { Companion } from "../figure/Companion";
import { setSoundsOn, sounds } from "../sound";
import { pokedLine } from "../state/lines";
import { useCompanionState } from "../state/useCompanionState";
import { useStation } from "../state/useStation";

type PanelState = "closed" | "open" | "closing";
const CLOSE_MS = 160;
/** What lights up under the pointer (see the pointer hover below). */
const HOVERABLE = ".chat, .btn, .choice, .iconbtn, .chip";
/** How long a finished chat's toast stays by the companion (the panel keeps the chat). */
const TOAST_MS = 12_000;
/** How long a reaction to a poke is said. */
const POKED_MS = 2200;
/** How long "I'm on Airband x now" shows after an update. */
const UPDATED_MS = 7000;

const toastKey = (f: FinishedView) => `${f.chatId}:${f.at}`;
const NONE: FinishedView[] = [];

/** The finished chats still shown as toasts: each goes TOAST_MS after it first came, or when closed. */
function useToasts(finished: FinishedView[]) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((key: string) => setGone((g) => new Set(g).add(key)), []);
  useEffect(() => {
    for (const f of finished) {
      const key = toastKey(f);
      if (!timers.current.has(key)) timers.current.set(key, setTimeout(() => dismiss(key), TOAST_MS));
    }
  }, [finished, dismiss]);
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);
  return { shown: finished.filter((f) => !gone.has(toastKey(f))), dismiss };
}

export function DesktopView() {
  const bridge = desktop!;
  // Asleep, updates that change nothing it shows are held back (see useStation).
  const calm = useRef(false);
  const { state, link, release } = useStation(calm);
  const [panel, setPanel] = useState<PanelState>("closed");
  /** The Mac is locked or asleep: nobody sees the screen, so every animation holds still. */
  const [unseen, setUnseen] = useState(false);
  // Awake while its panel is open; asleep after a quiet spell (see useCompanionState).
  const c = useCompanionState(state, panel !== "closed");
  const [settings, setSettings] = useState(false);
  const [place, setPlace] = useState<Place>({ side: "right", vertical: "bottom" });
  const [look, setLook] = useState({ dx: 0, dy: 0 });
  const [tucked, setTucked] = useState(false);
  const [prefs, setPrefs] = useState<DesktopPrefs>();
  const [entering, setEntering] = useState(true);
  /** Hiding and coming back: the whole corner fades and moves as one, on the graphics chip. */
  const [motion, setMotion] = useState<"leaving" | "arriving">();
  const motionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** A reaction to a poke, said for a moment. */
  const [line, setLine] = useState("");
  /** When it was last poked: the reaction shows for a moment after. */
  const [pokedAt, setPokedAt] = useState(0);
  useEffect(() => {
    if (!pokedAt) return;
    const t = setTimeout(() => setPokedAt(0), POKED_MS);
    return () => clearTimeout(t);
  }, [pokedAt]);
  const poked = pokedAt > 0;
  /** The very first start: one hello, then never again. */
  const [hello, setHello] = useState(false);
  /** Just updated: the new version, said once after the restart. */
  const [updated, setUpdated] = useState<string>();
  useEffect(() => {
    let done: ReturnType<typeof setTimeout> | undefined;
    void bridge.justUpdated?.().then((v) => {
      if (!v) return;
      setUpdated(v);
      done = setTimeout(() => setUpdated(undefined), UPDATED_MS);
    });
    return () => clearTimeout(done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** The Station has been out of reach for a while (a short restart says nothing). */
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (link) return setOffline(false);
    const t = setTimeout(() => setOffline(true), 3000);
    return () => clearTimeout(t);
  }, [link]);
  useEffect(() => {
    if (!prefs || prefs.greeted) return;
    const show = setTimeout(() => setHello(true), 1300);
    const done = setTimeout(() => (setHello(false), bridge.setPref("greeted", true)), 8300);
    return () => (clearTimeout(show), clearTimeout(done));
    // Once, when the settings arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs?.greeted]);
  const [error, setError] = useState<string>();
  const figure = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moving: boolean } | undefined>(undefined);
  const clicks = useRef<number[]>([]);

  const openPanel = (withSettings = false) => {
    setSettings(withSettings);
    setPanel((p) => {
      if (p !== "open") sounds.open();
      return "open";
    });
  };
  const closePanel = () => {
    setPanel((p) => {
      if (p === "open") sounds.close();
      return p === "open" ? "closing" : p;
    });
  };
  // Closing plays its animation, then the panel goes.
  useEffect(() => {
    if (panel !== "closing") return;
    const t = setTimeout(() => setPanel((p) => (p === "closing" ? "closed" : p)), CLOSE_MS);
    return () => clearTimeout(t);
  }, [panel]);
  const togglePanel = () => (panel === "open" ? closePanel() : openPanel());
  const tuck = (on: boolean) => {
    bridge.setPref("tucked", on);
    setTucked(on);
    (on ? sounds.tuck : sounds.untuck)();
    if (on) closePanel();
  };
  const setPref = (k: keyof DesktopPrefs, on: boolean) => {
    // At once, not when the app echoes it: the switch's own sound says the new setting.
    if (k === "sound") setSoundsOn(on);
    bridge.setPref(k, on);
    setPrefs((p) => (p ? { ...p, [k]: on } : p));
  };

  useEffect(() => {
    void bridge.prefs().then((p: DesktopPrefs) => (setPrefs(p), setTucked(p.tucked)));
    const offs = [onPrefs((p) => (setPrefs(p), setTucked(p.tucked))), onPlace(setPlace), onCursor(setLook)];
    const enter = setTimeout(() => setEntering(false), 1400);
    // Hover from the app's pointer, not the page's: a window that is not in front gets no mouse
    // moves, so after a click opened another app the row clicked stayed lit and no other lit up.
    let hoverTimer: ReturnType<typeof setInterval> | undefined;
    if (bridge.onPointer) {
      document.documentElement.classList.add("vhover");
      let lit: Element[] = [];
      let at: { x: number; y: number } | null = null;
      const light = () => {
        const now: Element[] = [];
        for (let el = at ? document.elementFromPoint(at.x, at.y) : null; el; el = el.parentElement) if (el.matches(HOVERABLE)) now.push(el);
        for (const el of lit) if (!now.includes(el)) el.classList.remove("vh");
        for (const el of now) el.classList.add("vh");
        lit = now;
      };
      offs.push(onPointer((p) => ((at = p), light())));
      // A row drawn again (the list refreshes) loses the class; the pointer may not have moved.
      hoverTimer = setInterval(light, 250);
    }
    offs.push(onCommand((cmd) => {
      if (cmd === "open") openPanel();
      if (cmd === "toggle") togglePanelRef.current();
      if (cmd === "today") void c.ask("today");
      if (cmd === "status") void c.ask("what's happening");
      if (cmd === "settings") openPanel(true);
      if (cmd === "arrive") c.wake();
      if (cmd === "unseen" || cmd === "seen") setUnseen(cmd === "unseen");
      if (cmd === "leave" || cmd === "arrive") {
        clearTimeout(motionTimer.current);
        setMotion(cmd === "leave" ? "leaving" : "arriving");
        if (cmd === "leave") sounds.close();
        else motionTimer.current = setTimeout(() => setMotion(undefined), 560);
      }
    }));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePanel();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(enter);
      clearTimeout(motionTimer.current);
      clearInterval(hoverTimer);
      offs.forEach((off) => off());
    };
    // Set up once; the toggle reads the latest panel state through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const togglePanelRef = useRef(togglePanel);
  useEffect(() => {
    togglePanelRef.current = togglePanel;
  });

  // What an answer asks the screen to do.
  useEffect(() => {
    if (c.answer?.action === "tuck") tuck(true);
    if (c.answer?.action === "settings") openPanel(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.answer]);

  // Asleep, the app stops following the pointer and the screen holds back updates that change
  // nothing it shows: no work while nothing is for you. Awake, the newest one shows at once.
  useEffect(() => {
    calm.current = c.asleep;
    bridge.setAsleep?.(c.asleep);
    if (!c.asleep) release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.asleep]);

  const onDown = (e: React.PointerEvent) => {
    c.wake();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.screenX, y: e.screenY, moving: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moving && Math.hypot(e.screenX - d.x, e.screenY - d.y) > 4) {
      d.moving = true;
      const r = figure.current!.getBoundingClientRect();
      bridge.dragStart({ x: r.x, y: r.y, width: r.width, height: r.height });
      // The system moves the window from here, and keeps the pointer: nothing more comes to us.
      drag.current = undefined;
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = undefined;
    if (!d) return;
    if (tucked) return tuck(false);
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < 900), now];
    if (clicks.current.length >= 3) {
      clicks.current = [];
      closePanel();
      setLine(pokedLine());
      setPokedAt(now);
      return c.poke();
    }
    togglePanel();
  };

  // Clicks reach the window only over what it draws; elsewhere they go to the windows behind. The
  // app is told where the clickable parts are whenever they change.
  const areas = useRef("");
  const sendAreas = useCallback(() => {
    const rects = [...document.querySelectorAll("[data-hit]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    }).filter((r) => r.width > 0 && r.height > 0);
    const key = JSON.stringify(rects);
    if (key !== areas.current) {
      areas.current = key;
      bridge.setHitAreas(rects);
    }
  }, [bridge]);
  useEffect(() => {
    const t = requestAnimationFrame(sendAreas);
    return () => cancelAnimationFrame(t);
  });
  // The panel changes size by itself too (a tab, a row's message box, its opening animation, a list
  // that grows): the parts are measured again as soon as one resizes, and a few times a second
  // anyway, so a click on the panel never falls through to the window behind.
  useEffect(() => {
    const ro = new ResizeObserver(sendAreas);
    const watch = () => document.querySelectorAll("[data-hit]").forEach((el) => ro.observe(el));
    watch();
    const mo = new MutationObserver(() => (watch(), sendAreas()));
    mo.observe(document.body, { childList: true, subtree: true });
    const end = sendAreas;
    document.addEventListener("animationend", end, true);
    document.addEventListener("transitionend", end, true);
    const iv = setInterval(end, 250);
    return () => {
      ro.disconnect();
      mo.disconnect();
      document.removeEventListener("animationend", end, true);
      document.removeEventListener("transitionend", end, true);
      clearInterval(iv);
    };
  }, [sendAreas]);

  // A new request or a finished chat while hidden or tucked away: the app brings it back.
  const seenKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!state || !bridge.comeBack) return;
    const ids = [...state.pending.map((p) => p.id), ...state.finished.map((f) => `${f.chatId}:${f.at}`)];
    const before = seenKey.current;
    seenKey.current = JSON.stringify(ids);
    if (before === undefined) return;
    const was = new Set(JSON.parse(before) as string[]);
    if (ids.some((id) => !was.has(id))) bridge.comeBack();
  }, [state, bridge]);

  const s = state;
  const pending = s?.pending ?? [];
  const toasts = useToasts(s?.finished ?? NONE);
  const showPanel = panel !== "closed" && s;
  const talk = <Conversation name={c.name} asking={c.asking} question={c.question} answer={c.answer} error={error} onClose={c.clearAnswer} onCloseError={() => setError(undefined)} onAsk={(q) => void c.ask(q)} />;
  return (
    <div className={`dock ${place.side} ${place.vertical}${motion ? ` ${motion}` : ""}${unseen ? " unseen" : ""}`}>
      {!tucked && (
        <div className="stack">
          {!showPanel && talk}
          {showPanel ? (
            <div className={panel === "closing" ? "panelwrap closing" : "panelwrap"}>
              <Panel state={s} name={c.name} design={c.design} onClose={closePanel} onAsk={(q) => (sounds.tick(), void c.ask(q))} asking={c.asking} onSay={c.say} onError={setError} showSettings={settings} prefs={prefs} onPref={setPref} answer={talk} hasAnswer={!!c.answer || !!error} />
            </div>
          ) : (
            <>
              {pending.slice(0, 3).map((p) => (
                <RequestCard key={p.id} request={p} onError={setError} compact={pending.length > 1} />
              ))}
              {pending.length > 3 && (
                <button className="more" data-hit onClick={() => openPanel()}>
                  {pending.length - 3} more need you
                </button>
              )}
              {toasts.shown.slice(0, pending.length ? 0 : 2).map((f) => (
                <FinishedToast key={toastKey(f)} finished={f} onClose={() => toasts.dismiss(toastKey(f))} />
              ))}
            </>
          )}
        </div>
      )}
      <div
        ref={figure}
        className={`companion${tucked ? " tucked" : ""}${entering ? " entering" : ""}`}
        data-hit
        onPointerDown={onDown}
        onPointerEnter={c.wake}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onContextMenu={(e) => {
          e.preventDefault();
          bridge.showMenu();
        }}
        title={tucked ? `Click to bring ${c.name} back` : `Click: your chats. Drag: move ${c.name}. Right-click: more.`}
      >
        {!tucked && (
          <div className="companion-controls">
            <button onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={() => tuck(true)} aria-label={`Tuck ${c.name} away`} title="Tuck away">
              <Minus size={13} />
            </button>
          </div>
        )}
        {offline && <span className="linkpill">Reconnecting…</span>}
        {!offline && hello && !tucked && panel === "closed" && (
          <span className="hello" role="status">
            Hi, I'm <b>{c.name}</b>! I'll tell you when a chat needs you.
          </span>
        )}
        {!offline && !hello && updated && !tucked && panel === "closed" && (
          <span className="hello" role="status">
            I'm on <b>Airband {updated}</b> now. Everything is where you left it.
          </span>
        )}
        {!offline && !hello && !updated && poked && <span className="hello short" role="status">{line}</span>}
        <Companion mood={c.mood} name={c.name} design={c.design} look={look} count={pending.length} size={104} />
      </div>
    </div>
  );
}
