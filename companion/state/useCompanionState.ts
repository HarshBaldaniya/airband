// What the companion shows and says, from the Station's state: the most urgent mood first, a sound
// (and a buzz on a phone) for each new request or finished chat, and its answers to the person.
import { useCallback, useEffect, useRef, useState } from "react";
import { desktop, onPrefs } from "../api/desktop-bridge";
import { api, type CompanionAnswer, type StationState } from "../api/station";
import { setSoundsOn, sounds } from "../sound";
import { moodOf, SLEEP_AFTER_MS } from "./mood";

/** The shortest the thinking card shows before an answer. */
const THINK_MS = 650;

/** `keepAwake`: the person is looking (its panel is open): it stays awake, and the quiet starts after. */
export function useCompanionState(state: StationState | undefined, keepAwake = false) {
  const [asking, setAsking] = useState(false);
  /** What the person asked last, shown above the answer, and when. */
  const [question, setQuestion] = useState<{ text: string; at: number }>();
  const [answer, setAnswer] = useState<CompanionAnswer>();
  const [talkUntil, setTalkUntil] = useState(0);
  const [hello, setHello] = useState(true);
  const [cheerUntil, setCheerUntil] = useState(0);
  const [dizzyUntil, setDizzyUntil] = useState(0);
  const [, tick] = useState(0);
  /** The last thing that was for the person: a request, a finish, a word, a touch. */
  const lastEvent = useRef(Date.now());
  const greeted = useRef(false);
  const seen = useRef<{ pending: Set<string>; finished: Set<string> } | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => setHello(false), 3000);
    void desktop?.prefs().then((p) => setSoundsOn(p.sound));
    const off = onPrefs((p) => setSoundsOn(p.sound));
    return () => (clearTimeout(t), off());
  }, []);

  // A new request or a finished chat: one sound each, once.
  useEffect(() => {
    if (!state) return;
    if (!greeted.current) {
      greeted.current = true;
      setTimeout(sounds.hello, 350);
    }
    // Something still going on (a chat working or waiting, a request): the quiet starts after it.
    if (state.pending.length || state.chats.some((c) => c.status === "working" || c.status === "waiting")) lastEvent.current = Date.now();
    const pending = new Set(state.pending.map((p) => p.id));
    const finished = new Set(state.finished.map((f) => `${f.chatId}:${f.at}`));
    const before = seen.current;
    seen.current = { pending, finished };
    if (!before) return;
    if ([...pending].some((id) => !before.pending.has(id))) {
      lastEvent.current = Date.now();
      sounds.needs();
      navigator.vibrate?.([40, 60, 40]);
    } else if ([...finished].some((id) => !before.finished.has(id))) {
      lastEvent.current = Date.now();
      sounds.done();
      setCheerUntil(Date.now() + 3500);
    }
  }, [state]);

  /** Something for the person: awake now, and the quiet counts from here. */
  const wake = useCallback(() => {
    lastEvent.current = Date.now();
    tick((n) => n + 1);
  }, []);

  const speak = useCallback((a: CompanionAnswer) => {
    lastEvent.current = Date.now();
    setAnswer(a);
    setTalkUntil(Date.now() + Math.min(8000, 1200 + a.text.length * 35));
  }, []);

  const ask = useCallback(
    async (q: string) => {
      lastEvent.current = Date.now();
      setQuestion({ text: q, at: Date.now() });
      setAnswer(undefined);
      setAsking(true);
      try {
        const started = Date.now();
        const a = await api.ask(q);
        // Even an answer it knows by heart gets a moment of thought: an instant reply reads as a jump.
        const think = THINK_MS + Math.min(400, a.text.length * 2) - (Date.now() - started);
        if (think > 0) await new Promise((r) => setTimeout(r, think));
        speak(a);
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
    lastEvent.current = Date.now();
    setDizzyUntil(Date.now() + 2400);
    sounds.boop();
  }, []);

  // The real time, not the Station's: its state arrives only when something changes, so its clock
  // stood still in a quiet hour, and the companion never fell asleep.
  const now = Date.now();
  const busy = !!state && (state.pending.length > 0 || state.chats.some((c) => c.status === "working" || c.status === "waiting"));
  if (keepAwake || busy) lastEvent.current = now;
  const asleep = !keepAwake && now - lastEvent.current > SLEEP_AFTER_MS;
  const mood = moodOf(state, { dizzy: dizzyUntil > now, asking, talking: talkUntil > now, hello, cheering: cheerUntil > now, asleep });

  // One timer, for the next moment the mood can change by itself (an end of talking, cheering or
  // dizziness, or falling asleep), instead of a redraw every second. Asleep, nothing is due at all.
  const due = [talkUntil, cheerUntil, dizzyUntil, asleep || keepAwake ? 0 : lastEvent.current + SLEEP_AFTER_MS].filter((t) => t > now);
  const next = due.length ? Math.min(...due) : 0;
  useEffect(() => {
    if (!next) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(50, next - Date.now() + 30));
    return () => clearTimeout(t);
  }, [next]);
  const name = state?.settings.companion.name ?? "";
  const design = state?.settings.companion.design;
  return { mood, asleep: mood === "resting", wake, name, design, ask, asking, question, answer, clearAnswer: () => (setAnswer(undefined), setQuestion(undefined)), say, poke };
}
