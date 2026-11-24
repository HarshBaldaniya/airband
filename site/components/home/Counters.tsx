"use client";
// The numbers under the hero. The page carries the real numbers, so they read without JavaScript.
// Once the row comes on screen, each counts up to its number, unless the person asked for less
// motion.
import { useEffect, useRef, useState } from "react";

export interface Counter {
  value: number;
  label: string;
}

const COUNT_MS = 1400;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const format = (n: number) => n.toLocaleString("en-US");

function Count({ value, run }: { value: number; run: boolean }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (!run || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      setShown(Math.round(value * ease(t)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [run, value]);
  return <b>{format(shown)}</b>;
}

export function Counters({ items }: { items: Counter[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setRun(true), io.disconnect()), { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  if (!items.length) return null;
  return (
    <div className="counters" ref={ref}>
      {items.map((c) => (
        <div key={c.label} className="counter">
          <Count value={c.value} run={run} />
          <span>{c.label}</span>
        </div>
      ))}
    </div>
  );
}
