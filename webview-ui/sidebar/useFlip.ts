import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Slides rows to their new place when the list reorders (a chat moving from
 * Working to Today, say), instead of letting them jump. Positions are measured
 * inside the list, so scrolling never sets anything moving.
 */
export function useFlip(ref: RefObject<HTMLDivElement | null>): void {
  const prev = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const next = new Map<string, number>();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const id = el.dataset.flip!;
      const top = el.offsetTop;
      next.set(id, top);
      const before = prev.current.get(id);
      if (reduce || before === undefined || Math.abs(before - top) < 2) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${before - top}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform .32s cubic-bezier(.2, .8, .2, 1)";
        el.style.transform = "";
      });
    });
    prev.current = next;
  });
}
