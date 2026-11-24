// The companion's sounds, made on the spot with the browser's own synthesiser: no sound files.
// Soft and short, so they say what happened without being noticed as noise. One switch (Sounds)
// turns them all off.
/** Whether sounds are on: unknown until the desktop app says (a browser has no switch: on). */
let enabled: boolean | undefined;
/** A sound asked for before the switch was known, played once it is if still fresh. */
let held: { notes: Note[]; at: number } | undefined;
/** A sound that would start later than this after it was asked for is dropped: late is wrong. */
const STALE_MS = 1500;

interface Note {
  /** Hz; `to` glides the pitch there over the note. */
  f: number;
  to?: number;
  at?: number;
  len: number;
  gain?: number;
  wave?: OscillatorType;
}

/** On or off, from the app's setting. Turned on, a sound held while it was unknown plays now. */
export function setSoundsOn(on: boolean): void {
  enabled = on;
  const h = held;
  held = undefined;
  if (on && h && Date.now() - h.at < STALE_MS) play(h.notes, h.at);
}

/** Pages with no desktop app (the phone page) have no switch: sounds are on there. */
export function soundsHaveNoSwitch(): void {
  if (enabled === undefined) setSoundsOn(true);
}

// One audio context for the page. The system can stop it at any time: it starts "suspended" until
// the person clicks or types in the page, and becomes "interrupted" or "suspended" when the Mac
// sleeps or the output changes (headphones). So it is started again before each sound, and the
// sound is scheduled only once its clock runs: notes scheduled on a stopped clock were lost.
let ctx: AudioContext | undefined;

function context(): AudioContext | undefined {
  try {
    if (!ctx || ctx.state === "closed") ctx = new AudioContext();
    return ctx;
  } catch {
    return undefined;
  }
}

/** Start the audio from a click or key press, when the system lets a page start it. */
function unlock(): void {
  const c = context();
  if (c && c.state !== "running") void c.resume().catch(() => undefined);
}
if (typeof window !== "undefined") {
  for (const e of ["pointerdown", "keydown"]) window.addEventListener(e, unlock, { capture: true, passive: true });
}

function play(notes: Note[], asked = Date.now()): void {
  if (enabled === false) return;
  if (enabled === undefined) {
    held = { notes, at: asked };
    return;
  }
  const c = context();
  if (!c) return;
  if (c.state === "running") return schedule(c, notes);
  c.resume()
    .then(() => {
      if (c.state === "running" && Date.now() - asked < STALE_MS) schedule(c, notes);
    })
    .catch(() => undefined);
}

function schedule(c: AudioContext, notes: Note[]): void {
  try {
    const out = c.createGain();
    out.gain.value = 0.9;
    out.connect(c.destination);
    // A moment ahead, so the first note's start is never in the past.
    const now = c.currentTime + 0.01;
    for (const n of notes) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = n.wave ?? "sine";
      const t = now + (n.at ?? 0);
      o.frequency.setValueAtTime(n.f, t);
      if (n.to) o.frequency.exponentialRampToValueAtTime(n.to, t + n.len);
      const peak = n.gain ?? 0.045;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + n.len);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + n.len + 0.03);
    }
  } catch {
    // No sound on this device: nothing else changes.
  }
}

/** Forget the setting and the audio (tests). */
export function forgetSounds(): void {
  enabled = undefined;
  held = undefined;
  ctx = undefined;
}

export const sounds = {
  /** The app starts: a small three-note hello. */
  hello: () => play([{ f: 523, len: 0.14, wave: "triangle" }, { f: 659, at: 0.1, len: 0.14, wave: "triangle" }, { f: 988, at: 0.2, len: 0.26, wave: "triangle", gain: 0.04 }]),
  /** A chat needs you: two soft notes, rising. */
  needs: () => play([{ f: 660, len: 0.18 }, { f: 880, at: 0.14, len: 0.26 }]),
  /** A chat finished: a short happy run. */
  done: () => play([{ f: 523, len: 0.12, wave: "triangle" }, { f: 659, at: 0.09, len: 0.12, wave: "triangle" }, { f: 784, at: 0.18, len: 0.12, wave: "triangle" }, { f: 1047, at: 0.27, len: 0.24, wave: "triangle", gain: 0.035 }]),
  /** The panel opens and closes. */
  open: () => play([{ f: 420, to: 620, len: 0.12, gain: 0.03 }]),
  close: () => play([{ f: 560, to: 380, len: 0.12, gain: 0.028 }]),
  /** A switch turns on, or off. */
  on: () => play([{ f: 880, len: 0.06, gain: 0.03 }, { f: 1320, at: 0.05, len: 0.08, gain: 0.025 }]),
  off: () => play([{ f: 700, len: 0.06, gain: 0.03 }, { f: 470, at: 0.05, len: 0.08, gain: 0.025 }]),
  /** A button press that sends something. */
  tick: () => play([{ f: 1200, len: 0.04, gain: 0.02, wave: "triangle" }]),
  /** Tucked away, and brought back. */
  tuck: () => play([{ f: 700, to: 260, len: 0.22, gain: 0.035 }]),
  untuck: () => play([{ f: 300, to: 760, len: 0.18, gain: 0.035 }, { f: 1046, at: 0.17, len: 0.12, gain: 0.025, wave: "triangle" }]),
  /** Falling asleep: a slow, soft sigh down. */
  yawn: () => play([{ f: 520, to: 300, len: 0.7, gain: 0.025 }]),
  /** Waking with a start: a quick chirp up. */
  wake: () => play([{ f: 500, to: 1000, len: 0.12, gain: 0.035 }, { f: 1180, at: 0.12, len: 0.1, gain: 0.025, wave: "triangle" }]),
  /** Poked. */
  boop: () => play([{ f: 420, to: 300, len: 0.1, gain: 0.04, wave: "square" }]),
};
