// The companion's few sounds, made on the spot with the browser's own synthesiser: no sound files.
let ctx: AudioContext | undefined;

function tone(freq: number, at: number, dur: number, gain = 0.06, type: OscillatorType = "sine"): void {
  ctx ??= new AudioContext();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + at;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sounds = {
  /** A chat needs you: two soft notes, rising. */
  needs: () => {
    tone(660, 0, 0.16);
    tone(880, 0.13, 0.22);
  },
  /** A chat finished: a short happy run. */
  done: () => {
    tone(523, 0, 0.12, 0.05, "triangle");
    tone(659, 0.09, 0.12, 0.05, "triangle");
    tone(784, 0.18, 0.22, 0.05, "triangle");
  },
  /** The companion was poked. */
  boop: () => tone(420, 0, 0.09, 0.05, "square"),
};
