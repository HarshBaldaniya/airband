// The desktop corner: the companion, and next to it the cards that need you or its panel. The
// window keeps one size and lets clicks through everywhere except on what it draws, so opening the
// panel never moves or redraws the companion. Drag it anywhere; tuck it away small; right-click it
// for the app's menu.
import { useEffect, useRef, useState } from "react";
import { Minus } from "lucide-react";
import { desktop, type DesktopPrefs } from "../api";
import { Companion } from "../companion/Companion";
import { useCompanionState } from "../companion/useCompanionState";
import { AnswerCard, FinishedCard, RequestCard } from "../components/Cards";
import { Panel } from "../components/Panel";
import { useStation } from "./useStation";

type PanelState = "closed" | "open" | "closing";
const CLOSE_MS = 160;

export function DesktopView() {
  const bridge = desktop!;
  const { state, link } = useStation();
  const c = useCompanionState(state);
  const [panel, setPanel] = useState<PanelState>("closed");
  const [settings, setSettings] = useState(false);
  const [place, setPlace] = useState<{ side: "left" | "right"; vertical: "top" | "bottom" }>({ side: "right", vertical: "bottom" });
  const [look, setLook] = useState({ dx: 0, dy: 0 });
  const [tucked, setTucked] = useState(false);
  const [error, setError] = useState<string>();
  const figure = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moving: boolean } | undefined>(undefined);
  const clicks = useRef<number[]>([]);
  const hit = useRef(false);

  const openPanel = (withSettings = false) => {
    setSettings(withSettings);
    setPanel("open");
  };
  const closePanel = () => {
    setPanel((p) => (p === "open" ? "closing" : p));
    setTimeout(() => setPanel((p) => (p === "closing" ? "closed" : p)), CLOSE_MS);
  };
  const togglePanel = () => (panel === "open" ? closePanel() : openPanel());
  const tuck = (on: boolean) => {
    bridge.setPref("tucked", on);
    setTucked(on);
    if (on) closePanel();
  };

  useEffect(() => {
    void bridge.prefs().then((p: DesktopPrefs) => setTucked(p.tucked));
    bridge.onPrefs((p) => setTucked(p.tucked));
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
      if (drag.current) return;
      const over = !!(document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-hit]");
      if (over !== hit.current) {
        hit.current = over;
        bridge.setHit(over);
      }
    };
    const onLeave = () => {
      if (drag.current) return;
      hit.current = false;
      bridge.setHit(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePanel();
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("keydown", onKey);
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
      return c.poke();
    }
    togglePanel();
  };

  const s = state;
  const pending = s?.pending ?? [];
  const finished = s?.finished ?? [];
  const showPanel = panel !== "closed" && s;
  return (
    <div className={`dock ${place.side} ${place.vertical}`}>
      {!tucked && (
        <div className="stack">
          {error && <AnswerCard answer={{ text: error, via: "action" }} onClose={() => setError(undefined)} onChoose={() => undefined} />}
          {!link && <AnswerCard answer={{ text: "I can't reach the Station. Trying again…", via: "action" }} onClose={() => undefined} onChoose={() => undefined} />}
          {c.answer && <AnswerCard answer={c.answer} onClose={c.clearAnswer} onChoose={(q) => void c.ask(q)} />}
          {showPanel ? (
            <div className={panel === "closing" ? "panelwrap closing" : "panelwrap"}>
              <Panel state={s} name={c.name} design={c.design} onClose={closePanel} onAsk={(q) => void c.ask(q)} asking={c.asking} onSay={c.say} onError={setError} showSettings={settings} />
            </div>
          ) : (
            <>
              {pending.slice(0, 2).map((p) => (
                <RequestCard key={p.id} request={p} onError={setError} />
              ))}
              {pending.length > 2 && (
                <button className="more" data-hit onClick={() => openPanel()}>
                  {pending.length - 2} more need you
                </button>
              )}
              {finished.slice(0, pending.length ? 0 : 1).map((f) => (
                <FinishedCard key={`${f.chatId}:${f.at}`} finished={f} onSay={c.say} />
              ))}
            </>
          )}
        </div>
      )}
      <div
        ref={figure}
        className={`companion${tucked ? " tucked" : ""}`}
        data-hit
        onPointerDown={onDown}
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
        <Companion mood={c.mood} name={c.name} design={c.design} look={look} count={pending.length} size={tucked ? 56 : 104} />
      </div>
    </div>
  );
}
