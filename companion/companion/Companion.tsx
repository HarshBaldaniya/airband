// The companion as the screens use it: whichever design is chosen, with the behaviour every design
// shares. It blinks at no fixed beat, and now and then, when nothing needs you, it looks around,
// wiggles or hops.
import { useEffect, useRef, useState } from "react";
import { designById } from "./designs";
import { sounds } from "../sound";
import type { CompanionDesign, Gesture, Mood, Phase } from "./types";
import "./motion.css";

const CALM: Mood[] = ["idle", "working"];
const GESTURES: Gesture[] = ["look-left", "look-right", "wiggle", "hop", "look-left", "look-right", "turn"];

/** Eyes shut now and then, sometimes twice, never on a beat. */
function useBlinking(paused: boolean): boolean {
  const [shut, setShut] = useState(false);
  useEffect(() => {
    if (paused) return;
    let t: ReturnType<typeof setTimeout>;
    const blink = (then: () => void) => {
      setShut(true);
      t = setTimeout(() => (setShut(false), then()), 270);
    };
    const next = () => {
      t = setTimeout(() => blink(() => (Math.random() < 0.2 ? (t = setTimeout(() => blink(next), 120)) : next())), 2200 + Math.random() * 4200);
    };
    next();
    return () => clearTimeout(t);
  }, [paused]);
  return shut;
}

/** A small gesture every 10 to 25 seconds while the companion is calm. */
function useGestures(mood: Mood): Gesture {
  const [gesture, setGesture] = useState<Gesture>("");
  useEffect(() => {
    if (!CALM.includes(mood)) return setGesture("");
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(() => {
        setGesture(GESTURES[Math.floor(Math.random() * GESTURES.length)]);
        t = setTimeout(() => (setGesture(""), next()), 1300);
      }, 10_000 + Math.random() * 15_000);
    };
    next();
    return () => clearTimeout(t);
  }, [mood]);
  return gesture;
}

/** Floats for a while after anything happens, then holds still in the air; one float every so
 *  often keeps it alive. While still, its window costs nothing to show. */
const AWAKE_MS = 12_000;
const BREATH_EVERY_MS = 40_000;
const BREATH_MS = 4_700;

function useAwake(mood: Mood, look: { dx: number; dy: number }): boolean {
  const [awake, setAwake] = useState(true);
  const until = useRef(0);
  const wake = (ms: number) => {
    until.current = Math.max(until.current, Date.now() + ms);
    setAwake(true);
  };
  // A new mood, or the pointer coming near: float again.
  useEffect(() => wake(AWAKE_MS), [mood]);
  const near = Math.abs(look.dx) + Math.abs(look.dy) > 0;
  useEffect(() => {
    if (near) wake(AWAKE_MS);
  }, [near, look.dx, look.dy]);
  // Asleep, it lies still: no breaths, and nothing to check.
  const resting = mood === "resting";
  useEffect(() => {
    if (resting) return setAwake(false);
    const check = setInterval(() => {
      if (Date.now() > until.current) setAwake(false);
    }, 1000);
    const breath = setInterval(() => wake(BREATH_MS), BREATH_EVERY_MS);
    return () => (clearInterval(check), clearInterval(breath));
  }, [resting]);
  return awake;
}

const DOZE_MS = 2600;
const WAKE_MS = 1300;

/** Falling asleep and waking up get a moment of their own; while dozing, the face still shows awake. */
function usePhase(mood: Mood): { shown: Mood; phase: Phase } {
  const [phase, setPhase] = useState<Phase>("");
  const was = useRef(mood);
  useEffect(() => {
    const before = was.current;
    was.current = mood;
    let t: ReturnType<typeof setTimeout> | undefined;
    if (mood === "resting" && before !== "resting") {
      setPhase("dozing");
      sounds.yawn();
      t = setTimeout(() => setPhase(""), DOZE_MS);
    } else if (before === "resting" && mood !== "resting") {
      setPhase("waking");
      sounds.wake();
      t = setTimeout(() => setPhase(""), WAKE_MS);
    }
    return () => t && clearTimeout(t);
  }, [mood]);
  return { shown: phase === "dozing" ? "idle" : mood, phase };
}

export interface CompanionProps {
  mood: Mood;
  name: string;
  design?: string;
  look?: { dx: number; dy: number };
  count?: number;
  size?: number;
}

/**
 * Scenes for the moods that last (asleep, working): the effects play now and then, not all the
 * time. A frame costs the same however little moves, so endless motion would keep the computer
 * busy all day. One scene starts at once, then one every `every` ms (slower after a long sleep).
 */
const SCENE: Partial<Record<Mood, { length: number; every: number; later?: { after: number; every: number } }>> = {
  resting: { length: 5_600, every: 40_000, later: { after: 10 * 60_000, every: 90_000 } },
  working: { length: 4_000, every: 15_000 },
};

function useScene(mood: Mood): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const s = SCENE[mood];
    if (!s) return setOn(false);
    const since = Date.now();
    let t: ReturnType<typeof setTimeout>;
    const play = () => {
      setOn(true);
      t = setTimeout(() => {
        setOn(false);
        const every = s.later && Date.now() - since > s.later.after ? s.later.every : s.every;
        t = setTimeout(play, Math.max(0, every - s.length));
      }, s.length);
    };
    play();
    return () => clearTimeout(t);
  }, [mood]);
  return on;
}

export function Companion({ mood: target, name, design, look = { dx: 0, dy: 0 }, count = 0, size = 104 }: CompanionProps) {
  const d = designById(design);
  const { shown: mood, phase } = usePhase(target);
  const blinking = useBlinking(mood === "resting" || mood === "dizzy");
  const gesture = useGestures(mood);
  const awake = useAwake(mood, look);
  const scene = useScene(phase ? "idle" : mood);
  // The figure in a layer of its own that floats; its shadow stays on the ground below.
  return (
    <div className={`companion-figure mood-${mood}${gesture ? ` gesture-${gesture}` : ""}${awake || gesture || phase || mood === "needs" ? "" : " still"}${phase ? ` phase-${phase}` : ""}${scene ? " scene" : ""}`} style={{ width: size, height: size * d.aspect }}>
      <span className="figure-shadow" aria-hidden="true" />
      <div className="figure-motion">
        <d.Figure mood={mood} look={look} blinking={blinking && !phase} gesture={phase ? "" : gesture} phase={phase} count={count} size={size} label={`${name}: ${mood}`} />
        <Effects spots={d.spots} size={size} />
      </div>
    </div>
  );
}

/**
 * The effects every design shares, drawn in front of the figure as small layers of their own: the
 * graphics chip moves them without redrawing the figure, so they cost next to nothing. Which ones
 * show is the mood's (motion.css): radio waves from the antenna while a chat works; "z"s, a breath
 * and a sleep bubble while asleep. More can join here the same way.
 */
function Effects({ spots, size }: { spots?: CompanionDesign["spots"]; size: number }) {
  if (!spots) return null;
  const at = (p: [number, number]) => ({ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` });
  return (
    <span className="fx" aria-hidden="true" style={{ fontSize: size / 10 }}>
      {spots.antenna && (
        <span className="fx-antenna" style={at(spots.antenna)}>
          <b />
          <i />
          <i />
        </span>
      )}
      {spots.mouth && <span className="fx-bubble" style={at(spots.mouth)} />}
      {spots.above && (
        <span className="fx-zzz" style={at(spots.above)}>
          <i>z</i>
          <i>z</i>
          <i>z</i>
        </span>
      )}
    </span>
  );
}

export function CompanionMark({ design, size = 28 }: { design?: string; size?: number }) {
  const d = designById(design);
  return <d.Mark size={size} />;
}
