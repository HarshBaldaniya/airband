"use client";
// "On the air": how often Airband was downloaded from npm. One big number inside a broadcast's
// rings. Each time the section comes on screen the rings draw themselves in, sparks of signal run
// along them, and every digit rolls into place like a dial, unless the person asked for less
// motion. The page carries the build's number, so it reads without JavaScript, and the browser
// brings it up to npm's count of now.
import { useEffect, useRef, useState } from "react";
import { FIRST_DAY, type Stats as Numbers } from "@/lib/stats";

/** The rings, from the inside out, as radii in the drawing's units (it is 800 wide). */
const RINGS = [150, 210, 270, 330, 390];
const format = (n: number) => n.toLocaleString("en-US");
const since = new Date(`${FIRST_DAY}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** Each digit rolls from 0 to its value on a strip of 0 to 9; the last digits settle last. */
function Rolling({ value, run }: { value: number; run: boolean }) {
  const text = format(value);
  let digitIndex = 0;
  return (
    <b className="rolling" aria-label={text}>
      {[...text].map((ch, i) => {
        if (!/\d/.test(ch)) {
          return (
            <span key={i} className="sep" aria-hidden="true">
              {ch}
            </span>
          );
        }
        const d = Number(ch);
        const order = digitIndex++;
        return (
          <span key={i} className="digit" aria-hidden="true">
            <span className="strip" style={{ ["--d" as string]: run ? d : 0, ["--o" as string]: order }}>
              {"0123456789".split("").map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </b>
  );
}

/** Half rings around the number, fading out towards their ends. Each is drawn as two halves from
 *  its top, so it draws itself outward to both ends, and a spark of signal runs along it. */
function Rings() {
  const half = (r: number, side: 1 | -1) => `M 400 ${400 - r} A ${r} ${r} 0 0 ${side === 1 ? 1 : 0} ${400 + side * r} 400`;
  const whole = (r: number) => `M ${400 - r} 400 A ${r} ${r} 0 0 1 ${400 + r} 400`;
  return (
    <svg className="signal-rings" viewBox="0 0 800 400" aria-hidden="true">
      <defs>
        <linearGradient id="ring-fade" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="0" y2="400">
          <stop offset="0" stopColor="var(--brand-2)" stopOpacity="1" />
          <stop offset="0.7" stopColor="var(--brand)" stopOpacity="0.55" />
          <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
        <filter id="spark-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {RINGS.map((r, i) =>
        ([-1, 1] as const).map((side) => <path key={`${r}${side}`} className="ring" pathLength={1} d={half(r, side)} style={{ ["--i" as string]: i }} />),
      )}
      {RINGS.map((r, i) => (
        <path key={`spark${r}`} className={`spark${i % 2 ? " back" : ""}`} pathLength={1} d={whole(r)} filter="url(#spark-glow)" style={{ ["--i" as string]: i }} />
      ))}
    </svg>
  );
}

/** npm's count right now. The page starts with the build's numbers; the browser then asks npm's
 *  public counter once (npm caches each answer for 5 minutes), with no cookie and no referrer. An
 *  answer that can't be read, or is lower than the build's, leaves the build's number. */
function useLiveNumbers(built: Numbers): Numbers {
  const [n, setN] = useState(built);
  useEffect(() => {
    const stop = new AbortController();
    const read = (range: string) =>
      fetch(`https://api.npmjs.org/downloads/point/${range}/airband`, { signal: stop.signal, credentials: "omit", referrerPolicy: "no-referrer" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: { downloads?: unknown } | null) => (typeof b?.downloads === "number" ? b.downloads : undefined))
        .catch(() => undefined);
    const today = new Date().toISOString().slice(0, 10);
    void Promise.all([read(`${FIRST_DAY}:${today}`), read("last-week")]).then(([total, week]) => {
      if (stop.signal.aborted) return;
      setN((old) => ({ total: total && total >= (old.total ?? 0) ? total : old.total, week: week || old.week }));
    });
    return () => stop.abort();
  }, []);
  return n;
}

export function Stats({ numbers }: { numbers: Numbers }) {
  const n = useLiveNumbers(numbers);
  const ref = useRef<HTMLElement>(null);
  // Starts true so the page, before JavaScript, carries the real number.
  const [run, setRun] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setRun(false);
    // Each time the number comes on screen it rolls in again; off screen it waits at 0.
    const io = new IntersectionObserver(([e]) => setRun(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Nothing could be read: no section, rather than a wrong number.
  if (!n.total) return null;
  return (
    <section ref={ref} className={`section onair${run ? " run" : ""}`}>
      <div className="wrap">
        <div className="head">
          <h2 className="grad">On the air since {since}.</h2>
          <p>Every download, as npm counts it.</p>
        </div>
        <div className="signal">
          <span className="glow" aria-hidden="true" />
          <Rings />
          <div className="signal-count">
            <Rolling value={n.total} run={run} />
            <span>npm downloads</span>
          </div>
        </div>
        {!!n.week && (
          <p className="onair-week">
            <b>{format(n.week)}</b> in the last 7 days
          </p>
        )}
        <p className="onair-note">Downloads, not people. Live from npm.</p>
      </div>
    </section>
  );
}
