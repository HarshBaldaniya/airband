// The companion's few words of its own: a short line on hover that fits the moment, and a reaction
// when poked. Radio talk, since Airband is a radio band. They never name the companion, so a new
// name or design keeps them.
import type { Mood } from "./types";

const LINES: Partial<Record<Mood, string[]>> = {
  idle: ["Roger that.", "Standing by.", "All quiet on the band.", "Loud and clear.", "Nothing on the radar."],
  working: ["Your chats are busy. I'm listening.", "Standing by while they work.", "Keeping an ear on it."],
  needs: ["Someone needs you.", "Incoming! Have a look.", "A chat is waiting on you."],
  done: ["All done. Nice work.", "That one's finished."],
  resting: ["Zzz… click to wake me.", "Resting my antenna."],
  thinking: ["Looking it up…"],
};
const POKED = ["Hey, that tickles!", "Easy on the antenna!", "Okay, okay, I'm awake.", "Boop received."];

const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

export function moodLine(mood: Mood): string {
  return pick(LINES[mood] ?? LINES.idle!);
}

export function pokedLine(): string {
  return pick(POKED);
}
