import { useEffect, useRef, type RefObject } from "react";
import { LAYER, useKeys } from "./useKeys";

/**
 * Closes a menu or popover on a click anywhere outside `ref`, and on Esc (the Esc goes no further,
 * so it doesn't also clear a selection or leave focus). Only while `open`. With `onBlur`, it also
 * closes when the page loses focus.
 */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void, { onBlur = false } = {}): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useKeys(LAYER.menu, (e) => e.key === "Escape" && (closeRef.current(), true), open);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    const blur = () => closeRef.current();
    document.addEventListener("pointerdown", away, true);
    if (onBlur) window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", blur);
    };
  }, [open, ref, onBlur]);
}
