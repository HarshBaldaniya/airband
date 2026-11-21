// What the companion shows and says, from the Station's state: the most urgent mood first, a sound
// (and a buzz on a phone) for each new request or finished chat, and its answers to the person.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, desktop, type CompanionAnswer, type StationState } from "../api";
import { sounds } from "../sound";
import type { Mood } from "./types";

const QUIET_MS = 3 * 60_000;

export function moodOf(s: StationState | undefined, now: number, x: { dizzy: boolean; asking: boolean; talking: boolean; hello: boolean; cheering: boolean }): Mood {
  if (x.dizzy) return "dizzy";
  if (x.asking) return "thinking";
  if (x.talking) return "talking";
  if (x.hello) return "hello";
  if (!s) return "idle";
  if (s.pending.length || s.chats.some((c) => c.status === "waiting")) return "needs";
  if (x.cheering) return "done";
  if (s.chats.some((c) => c.status === "working")) return "working";
  const last = Math.max(0, ...s.chats.map((c) => c.since));
  return now - last > QUIET_MS ? "resting" : "idle";
}

export function useCompanionState(state: StationState | undefined) {
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<CompanionAnswer>();
  const [talkUntil, setTalkUntil] = useState(0);
  const [hello, setHello] = useState(true);
  const [cheerUntil, setCheerUntil] = useState(0);
  const [dizzyUntil, setDizzyUntil] = useState(0);
  const [, tick] = useState(0);
  const sound = useRef(true);
  const seen = useRef<{ pending: Set<string>; finished: Set<string> } | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => setHello(false), 3000);
    void desktop?.prefs().then((p) => (sound.current = p.sound));
    desktop?.onPrefs((p) => (sound.current = p.sound));
    const i = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, []);

  // A new request or a finished chat: one sound each, once.
  useEffect(() => {
    if (!state) return;
    const pending = new Set(state.pending.map((p) => p.id));
    const finished = new Set(state.finished.map((f) => `${f.chatId}:${f.at}`));
    const before = seen.current;
    seen.current = { pending, finished };
    if (!before) return;
    if ([...pending].some((id) => !before.pending.has(id))) {
      if (sound.current) sounds.needs();
      navigator.vibrate?.([40, 60, 40]);
    } else if ([...finished].some((id) => !before.finished.has(id))) {
      if (sound.current) sounds.done();
      setCheerUntil(Date.now() + 3500);
    }
  }, [state]);

  const speak = useCallback((a: CompanionAnswer) => {
    setAnswer(a);
    setTalkUntil(Date.now() + Math.min(8000, 1200 + a.text.length * 35));
  }, []);

  const ask = useCallback(
    async (q: string) => {
      setAsking(true);
      try {
        speak(await api.ask(q));
      } catch (e) {
        speak({ text: e instanceof Error ? e.message : String(e), via: "records" });
      } finally {
        setAsking(false);
      }
    },
    [speak],
  );

  const say = useCallback((text: string) => speak({ text, via: "action" }), [speak]);

  const poke = useCallback(() => {
    setDizzyUntil(Date.now() + 2400);
    if (sound.current) sounds.boop();
  }, []);

  const now = Date.now();
  const mood = moodOf(state, state?.now ?? now, { dizzy: dizzyUntil > now, asking, talking: talkUntil > now, hello, cheering: cheerUntil > now });
  const name = state?.settings.companion.name ?? "";
  const design = state?.settings.companion.design;
  return { mood, name, design, ask, asking, answer, clearAnswer: () => setAnswer(undefined), say, poke };
}
