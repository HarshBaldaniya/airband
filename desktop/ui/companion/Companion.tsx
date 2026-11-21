// The companion as the screens use it: whichever design is chosen, with the behaviour every design
// shares. It blinks at no fixed beat, and now and then, when nothing needs you, it looks around,
// wiggles or hops.
import { useEffect, useState } from "react";
import { designById } from "./designs";
import type { Gesture, Mood } from "./types";

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
  return <d.Figure mood={mood} look={look} blinking={blinking} gesture={gesture} count={count} size={size} label={`${name}: ${mood}`} />;
}

export function CompanionMark({ design, size = 28 }: { design?: string; size?: number }) {
  const d = designById(design);
  return <d.Mark size={size} />;
}
