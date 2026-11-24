"use client";
// The top bar, in three equal parts so the links sit in the true middle: the name on the left,
// the pages in the centre, npm, GitHub and Download on the right. Clear over the page; glass once
// it scrolls.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WORDMARK } from "@/roger/wordmark";
import { NEW_TAB } from "@/lib/links";
import { NAV, SITE } from "@/lib/site";
import { GitHub, Npm } from "@/components/ui/BrandMarks";

export function SiteHeader() {
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  // A glass pill behind the current page's link. It slides to the link under the pointer, and
  // back when the pointer leaves.
  const nav = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number; on: boolean }>({ x: 0, w: 0, on: false });
  const moveTo = (el?: Element | null) => {
    const n = nav.current;
    if (!n || !el) return setPill((p) => ({ ...p, on: false }));
    const a = el.getBoundingClientRect();
    const b = n.getBoundingClientRect();
    setPill({ x: a.left - b.left, w: a.width, on: true });
  };
  const home = () => moveTo(nav.current?.querySelector('[aria-current="page"]'));
  useEffect(() => {
    home();
    window.addEventListener("resize", home);
    return () => window.removeEventListener("resize", home);
  }, [path]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`top${scrolled ? " scrolled" : ""}`}>
      <div className="wrap bar">
        <Link href="/" className="brand" aria-label="Airband home">
          <span className="mark" dangerouslySetInnerHTML={{ __html: WORDMARK }} />
        </Link>
        <nav ref={nav} onPointerLeave={home}>
          <span className={`pill${pill.on ? " on" : ""}`} style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden />
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined} onPointerEnter={(e) => moveTo(e.currentTarget)}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="right">
          <a className="icon" href={SITE.npm} aria-label="Airband on npm" {...NEW_TAB}>
            <Npm mono />
          </a>
          <a className="icon" href={SITE.repo} aria-label="Airband on GitHub" {...NEW_TAB}>
            <GitHub />
          </a>
          <Link className="btn small primary" href="/download/">
            Download
          </Link>
        </div>
      </div>
    </header>
  );
}
