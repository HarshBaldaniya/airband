// The Station's live state, and whether the screen can reach it.
import { useEffect, useState } from "react";
import { watchState, type StationState } from "../api";

export function useStation() {
  const [state, setState] = useState<StationState>();
  const [link, setLink] = useState(true);
  useEffect(() => watchState(setState, setLink), []);
  return { state, link };
}
