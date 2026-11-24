// The companion's few words of its own: a reaction when poked. Radio talk, since Airband is a radio
// band. They never name the companion, so a new name or design keeps them.
const POKED = ["Hey, that tickles!", "Easy on the antenna!", "Okay, okay, I'm awake.", "Boop received."];

export function pokedLine(): string {
  return POKED[Math.floor(Math.random() * POKED.length)];
}
