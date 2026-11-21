// The companion as the screens use it: whichever design is chosen, with the behaviour every design
// shares. It blinks at no fixed beat, and now and then, when nothing needs you, it looks around,
// wiggles or hops.
import { useEffect, useRef, useState } from "react";
import { designById } from "./designs";
import type { Gesture, Mood } from "./types";
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
  useEffect(() => {
    const check = setInterval(() => {
      if (Date.now() > until.current) setAwake(false);
    }, 1000);
    const breath = setInterval(() => wake(BREATH_MS), BREATH_EVERY_MS);
    return () => (clearInterval(check), clearInterval(breath));
  }, []);
  return awake;
}

export interface CompanionProps {
  mood: Mood;
  name: string;
  design?: string;
  look?: { dx: number; dy: number };
  count?: number;
  size?: number;
}

export function Companion({ mood, name, design, look = { dx: 0, dy: 0 }, count = 0, size = 104 }: CompanionProps) {
  const d = designById(design);
  const blinking = useBlinking(mood === "resting" || mood === "dizzy");
  const gesture = useGestures(mood);
  const awake = useAwake(mood, look);
  // The figure in a layer of its own that floats; its shadow stays on the ground below.
  return (
    <div className={`companion-figure mood-${mood}${gesture ? ` gesture-${gesture}` : ""}${awake || gesture || mood === "needs" ? "" : " still"}`} style={{ width: size, height: size * d.aspect }}>
      <span className="figure-shadow" aria-hidden="true" />
      <div className="figure-motion">
        <d.Figure mood={mood} look={look} blinking={blinking} gesture={gesture} count={count} size={size} label={`${name}: ${mood}`} />
      </div>
    </div>
  );
}

export function CompanionMark({ design, size = 28 }: { design?: string; size?: number }) {
  const d = designById(design);
  return <d.Mark size={size} />;
}
