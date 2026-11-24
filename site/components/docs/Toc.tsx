"use client";
// The guide's menu: at the side on wide screens, a row of chips on narrow ones. It marks the
// section you are reading.
import { useEffect, useState } from "react";

export function Toc({ items, chips }: { items: { id: string; title: string }[]; chips?: boolean }) {
  const [on, setOn] = useState(items[0].id);
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => {
        const seen = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setOn(seen.target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    items.forEach((i) => {
      const el = document.getElementById(i.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, [items]);
  return (
    <nav className={chips ? "toc-chips" : "toc"} aria-label="On this page">
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className={on === i.id ? "on" : undefined}>
          {i.title}
        </a>
      ))}
    </nav>
  );
}
