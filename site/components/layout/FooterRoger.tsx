"use client";
// Roger, small, at the end of every page: he waves when he comes into view and when the pointer is on him.
import { useEffect, useRef, useState } from "react";
import { Companion } from "@/roger/companion/Companion";
import type { Mood } from "@/roger/companion/types";
import { setSoundsOn } from "@/roger/sound";

export function FooterRoger() {
  const [mood, setMood] = useState<Mood>("idle");
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    setSoundsOn(false);
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setMood("hello"), setTimeout(() => setMood("idle"), 2400)), { threshold: 0.6 });
    if (el.current) io.observe(el.current);
    return () => io.disconnect();
  }, []);
  return (
    <span className="foot-roger" ref={el} onPointerEnter={() => setMood("done")} onPointerLeave={() => setMood("idle")}>
      <Companion mood={mood} name="Roger" size={54} />
    </span>
  );
}
