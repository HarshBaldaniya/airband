// The desktop corner: the companion, and next to it the cards that need you or its panel. The
// window keeps one size and lets clicks through everywhere except on what it draws, so opening the
// panel never moves or redraws the companion. Drag it anywhere; tuck it away small; right-click it
// for the app's menu.
import { useEffect, useRef, useState } from "react";
import { Minus } from "lucide-react";
import { desktop, type DesktopPrefs } from "../api";
import { Companion } from "../companion/Companion";
import { pokedLine } from "../companion/lines";
import { useCompanionState } from "../companion/useCompanionState";
import { FinishedToast, RequestCard } from "../components/Cards";
import { Conversation } from "../components/Conversation";
import { Panel } from "../components/Panel";
import { sounds } from "../sound";
import { useStation } from "./useStation";

type PanelState = "closed" | "open" | "closing";
const CLOSE_MS = 160;
/** How long a finished chat's toast stays by the companion (the panel keeps the chat). */
const TOAST_MS = 12_000;

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
  const [place, setPlace] = useState<{ side: "left" | "right"; vertical: "top" | "bottom" }>({ side: "right", vertical: "bottom" });
  const [look, setLook] = useState({ dx: 0, dy: 0 });
  const [tucked, setTucked] = useState(false);
  const [prefs, setPrefs] = useState<DesktopPrefs>();
  const [entering, setEntering] = useState(true);
  /** Hiding and coming back: the whole corner fades and moves as one, on the graphics chip. */
  const [motion, setMotion] = useState<"leaving" | "arriving">();
  const motionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** A reaction to a poke, said for a moment. */
  const [line, setLine] = useState("");
  const [poked, setPoked] = useState(false);
  /** The very first start: one hello, then never again. */
  const [hello, setHello] = useState(false);
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
  const hit = useRef(false);
  const pointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const toastSeen = useRef(new Map<string, number>());
  const [toastGone, setToastGone] = useState<Set<string>>(new Set());

  /** Takes clicks only where something is drawn under the pointer. Run on every move and after
   *  every change, so a card that goes away never leaves a spot that still catches clicks. */
  const checkHit = () => {
    const p = pointer.current;
    const over = !!p && !!(document.elementFromPoint(p.x, p.y) as HTMLElement | null)?.closest("[data-hit]");
    if (over !== hit.current) {
      hit.current = over;
      bridge.setHit(over);
    }
  };

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
    setTimeout(() => setPanel((p) => (p === "closing" ? "closed" : p)), CLOSE_MS);
  };
  const togglePanel = () => (panel === "open" ? closePanel() : openPanel());
  const tuck = (on: boolean) => {
    bridge.setPref("tucked", on);
    setTucked(on);
    (on ? sounds.tuck : sounds.untuck)();
    if (on) closePanel();
  };
  const setPref = (k: keyof DesktopPrefs, on: boolean) => {
    bridge.setPref(k, on);
    setPrefs((p) => (p ? { ...p, [k]: on } : p));
  };

  useEffect(() => {
    void bridge.prefs().then((p: DesktopPrefs) => (setPrefs(p), setTucked(p.tucked)));
    bridge.onPrefs((p) => (setPrefs(p), setTucked(p.tucked)));
    const enter = setTimeout(() => setEntering(false), 1400);
    bridge.onPlace(setPlace);
    bridge.onCursor(setLook);
    bridge.onCommand((cmd) => {
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
    });
    // Clicks reach the window only over what it draws; elsewhere they go to the windows behind.
    const onMove = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      if (!drag.current) checkHit();
    };
    const onLeave = () => {
      pointer.current = undefined;
      if (!drag.current) checkHit();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePanel();
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("keydown", onKey);
      clearTimeout(enter);
    };
    // Set up once; the toggle reads the latest panel state through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const togglePanelRef = useRef(togglePanel);
  togglePanelRef.current = togglePanel;

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
      if (bridge.nativeDrag) return void (drag.current = undefined);
    }
    if (d.moving) bridge.dragMove();
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = undefined;
    if (!d) return;
    if (d.moving) return bridge.dragEnd();
    if (tucked) return tuck(false);
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < 900), now];
    if (clicks.current.length >= 3) {
      clicks.current = [];
      closePanel();
      setLine(pokedLine());
      setPoked(true);
      setTimeout(() => setPoked(false), 2200);
      return c.poke();
    }
    togglePanel();
  };

  // After anything changes on screen, the spot under a still pointer is checked again. The lighter
  // app instead gets where the clickable parts are, whenever they change.
  const areas = useRef("");
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      checkHit();
      if (!bridge.setHitAreas) return;
      const rects = [...document.querySelectorAll("[data-hit]")].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      }).filter((r) => r.width > 0 && r.height > 0);
      const key = JSON.stringify(rects);
      if (key !== areas.current) {
        areas.current = key;
        bridge.setHitAreas(rects);
      }
    });
    return () => cancelAnimationFrame(t);
  });

  // A new request or a finished chat while hidden or tucked away: the lighter app brings it back.
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
  const now = Date.now();
  const finished = (s?.finished ?? []).filter((f) => {
    const key = `${f.chatId}:${f.at}`;
    if (!toastSeen.current.has(key)) {
      toastSeen.current.set(key, now);
      setTimeout(() => setToastGone((g) => new Set(g).add(key)), TOAST_MS);
    }
    return !toastGone.has(key);
  });
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
              {finished.slice(0, pending.length ? 0 : 2).map((f) => (
                <FinishedToast key={`${f.chatId}:${f.at}`} finished={f} onSay={c.say} onClose={() => setToastGone((g) => new Set(g).add(`${f.chatId}:${f.at}`))} />
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
        {!offline && !hello && poked && <span className="hello short" role="status">{line}</span>}
        <Companion mood={c.mood} name={c.name} design={c.design} look={look} count={pending.length} size={104} />
      </div>
    </div>
  );
}
