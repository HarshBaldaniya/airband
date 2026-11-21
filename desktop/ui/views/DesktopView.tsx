// The desktop corner: the companion, and next to it the cards that need you or its panel. The
// window keeps one size and lets clicks through everywhere except on what it draws, so opening the
// panel never moves or redraws the companion. Drag it anywhere; tuck it away small; right-click it
// for the app's menu.
import { useEffect, useRef, useState } from "react";
import { Minus } from "lucide-react";
import { desktop, type DesktopPrefs } from "../api";
import { Companion } from "../companion/Companion";
import { moodLine, pokedLine } from "../companion/lines";
import { useCompanionState } from "../companion/useCompanionState";
import { AnswerCard, FinishedToast, RequestCard } from "../components/Cards";
import { Panel } from "../components/Panel";
import { sounds } from "../sound";
import { useStation } from "./useStation";

type PanelState = "closed" | "open" | "closing";
const CLOSE_MS = 160;
/** How long a finished chat's toast stays by the companion (the panel keeps the chat). */
const TOAST_MS = 12_000;

export function DesktopView() {
  const bridge = desktop!;
  const { state, link } = useStation();
  const c = useCompanionState(state);
  const [panel, setPanel] = useState<PanelState>("closed");
  const [settings, setSettings] = useState(false);
  const [place, setPlace] = useState<{ side: "left" | "right"; vertical: "top" | "bottom" }>({ side: "right", vertical: "bottom" });
  const [look, setLook] = useState({ dx: 0, dy: 0 });
  const [tucked, setTucked] = useState(false);
  const [prefs, setPrefs] = useState<DesktopPrefs>();
  /** Bumped on each tuck and return, to play the "poof" once. */
  const [poof, setPoof] = useState(0);
  const [entering, setEntering] = useState(true);
  /** The short line on the name tag: picked when the pointer arrives, or a reaction to a poke. */
  const [line, setLine] = useState("");
  const [poked, setPoked] = useState(false);
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
    setPoof((n) => n + 1);
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

  const onDown = (e: React.PointerEvent) => {
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

  // After anything changes on screen, the spot under a still pointer is checked again.
  useEffect(() => {
    const t = requestAnimationFrame(checkHit);
    return () => cancelAnimationFrame(t);
  });

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
  return (
    <div className={`dock ${place.side} ${place.vertical}`}>
      {!tucked && (
        <div className="stack">
          {error && <AnswerCard answer={{ text: error, via: "action" }} onClose={() => setError(undefined)} onChoose={() => undefined} />}
          {!link && <AnswerCard answer={{ text: "I can't reach the Station. Trying again…", via: "action" }} onClose={() => undefined} onChoose={() => undefined} />}
          {c.answer && !showPanel && <AnswerCard answer={c.answer} onClose={c.clearAnswer} onChoose={(q) => void c.ask(q)} />}
          {showPanel ? (
            <div className={panel === "closing" ? "panelwrap closing" : "panelwrap"}>
              <Panel state={s} name={c.name} design={c.design} onClose={closePanel} onAsk={(q) => (sounds.tick(), void c.ask(q))} asking={c.asking} onSay={c.say} onError={setError} showSettings={settings} prefs={prefs} onPref={setPref} answer={c.answer && <AnswerCard answer={c.answer} onClose={c.clearAnswer} onChoose={(q) => void c.ask(q)} />} />
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
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerEnter={() => !poked && setLine(moodLine(c.mood))}
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
        {poof > 0 && <span key={poof} className="poof" aria-hidden="true" />}
        {!tucked && panel === "closed" && (
          <span className={`nametag${poked ? " show" : ""}`} aria-hidden="true">
            <b>{c.name}</b>
            <span className="brand">Airband</span>
            {line && <span className="nameline">{line}</span>}
          </span>
        )}
        <Companion mood={c.mood} name={c.name} design={c.design} look={look} count={pending.length} size={104} />
      </div>
    </div>
  );
}
