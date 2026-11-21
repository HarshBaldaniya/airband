// The companion's sounds, made on the spot with the browser's own synthesiser: no sound files.
// Soft and short, so they say what happened without being noticed as noise. One switch (Sounds)
// turns them all off.
let ctx: AudioContext | undefined;
let enabled = true;

export function setSoundsOn(on: boolean): void {
  enabled = on;
}

interface Note {
  /** Hz; `to` glides the pitch there over the note. */
  f: number;
  to?: number;
  at?: number;
  len: number;
  gain?: number;
  wave?: OscillatorType;
}

function play(notes: Note[]): void {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);
    for (const n of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = n.wave ?? "sine";
      const t = ctx.currentTime + (n.at ?? 0);
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
  /** Poked. */
  boop: () => play([{ f: 420, to: 300, len: 0.1, gain: 0.04, wave: "square" }]),
};
