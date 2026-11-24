// The Tower's own keys. The keys that switch pages are the board page's.
import type { RefObject } from "react";
import { typing } from "../../lib/keys";
import { LAYER, useKeys } from "../../lib/useKeys";
import type { ArrangeMode } from "./layout";

const BY_NUMBER: Record<string, ArrangeMode> = { "1": "links", "2": "time", "3": "agent", "4": "folder" };

export function useBoardKeys(k: {
  searchRef: RefObject<HTMLInputElement | null>;
  linking: boolean;
  stopLinking: () => void;
  query: string;
  clearQuery: () => void;
  anySelected: () => boolean;
  deselect: () => void;
  focus: boolean;
  toggleFocus: () => void;
  toggleTray: () => void;
  newChat: () => void;
  fit: () => void;
  arrange: ((mode: ArrangeMode) => void) | undefined;
}): void {
  useKeys(LAYER.page, (e) => {
    const mod = e.metaKey || e.ctrlKey;
    // ⌘F / Ctrl+F and / : find a chat on the board.
    if ((mod && e.key.toLowerCase() === "f") || (!mod && e.key === "/" && !typing(e))) {
      e.preventDefault();
      k.searchRef.current?.focus();
      k.searchRef.current?.select();
      return true;
    }
    if (e.key === "Escape") {
      // One step back at a time: linking, the search, the selection, then focus. An open menu
      // closes first, on its own layer.
      if (k.linking) k.stopLinking();
      else if (k.query) k.clearQuery();
      else if (k.anySelected()) k.deselect();
      else if (k.focus) k.toggleFocus();
      else return false;
      return true;
    }
    if (typing(e) || mod || e.altKey) return false;
    const key = e.key.toLowerCase();
    if (key === "f") k.toggleFocus();
    else if (key === "l") k.toggleTray();
    else if (key === "n") k.newChat();
    else if (key === "0") k.fit();
    else if (BY_NUMBER[key] && k.arrange) k.arrange(BY_NUMBER[key]);
    else return false;
    return true;
  });
}
