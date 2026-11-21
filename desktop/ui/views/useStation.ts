// The Station's live state, and whether the screen can reach it.
import { useEffect, useRef, useState } from "react";
import { watchState, type StationState } from "../api";

/** What can change an asleep companion: a request, a finished chat, a chat that waits, its own look. */
function wakeKey(s: StationState): string {
  return JSON.stringify([s.pending.map((p) => p.id), s.finished.map((f) => `${f.chatId}:${f.at}`), s.chats.filter((c) => c.status === "waiting").map((c) => c.id), s.settings, s.link]);
}

/**
 * `calm`: while it is true (the companion asleep), an update that changes none of the above is held
 * back, so a busy hour of working chats does not redraw a screen nobody is reading. The newest one
 * is shown the moment it wakes.
 */
export function useStation(calm?: { current: boolean }) {
  const [state, setState] = useState<StationState>();
  const [link, setLink] = useState(true);
  const held = useRef<StationState | undefined>(undefined);
  useEffect(
    () =>
      watchState((s) => {
        setState((was) => {
          if (calm?.current && was && wakeKey(was) === wakeKey(s)) {
            held.current = s;
            return was;
          }
          held.current = undefined;
          return s;
        });
      }, setLink),
    [calm],
  );
  /** Awake again: the newest held update, at once. */
  const release = () => {
    if (held.current) {
      setState(held.current);
      held.current = undefined;
    }
  };
  return { state, link, release };
}
