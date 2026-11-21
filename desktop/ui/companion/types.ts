// What every companion design draws, and what it is given. A design is only a look: the name, the
// moods and the behaviour are shared, so a new design (or a new name) changes nothing else.
import type { ReactElement } from "react";

/** What the companion shows, the most urgent first. */
export type Mood = "hello" | "idle" | "working" | "needs" | "done" | "resting" | "talking" | "thinking" | "dizzy";

/** A moment between moods: falling asleep, or waking with a start. */
export type Phase = "" | "dozing" | "waking";

/** A small thing the companion does now and then when nothing needs it. */
export type Gesture = "" | "look-left" | "look-right" | "wiggle" | "hop" | "turn";

export interface FigureProps {
  mood: Mood;
  /** Where the pointer is from the companion, -1 to 1 on each axis: the eyes follow it. */
  look: { dx: number; dy: number };
  /** Eyes shut for a blink. */
  blinking: boolean;
  gesture: Gesture;
  phase: Phase;
  /** How many requests wait; the design may show it. */
  count: number;
  /** Width in pixels; the height follows the design's own shape. */
  size: number;
  /** Read aloud by screen readers. */
  label: string;
}

/** A look for the companion. Add one in designs/ and list it in designs/index.ts. */
export interface CompanionDesign {
  id: string;
  /** Shown in the settings. */
  title: string;
  /** Height over width, so the space around it can be kept. */
  aspect: number;
  Figure: (p: FigureProps) => ReactElement;
  /** The same look at a small size, for headers and lists. */
  Mark: (p: { size: number }) => ReactElement;
  /** Where the shared effects sit on this figure, as parts of its width and height (0 to 1): the
   *  antenna's radio waves while working, the sleep bubble at the mouth, the "z"s above. */
  spots?: { antenna?: [number, number]; mouth?: [number, number]; above?: [number, number] };
}
