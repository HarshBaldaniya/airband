"use client";
// "On the air": how often Airband was downloaded, as a radio dial. One big number, and under it a
// tuning scale whose ticks are the real downloads of each day since the first version, the last
// week lit. When the section comes on screen the number counts up and the needle sweeps to today,
// lighting the days it passes, unless the person asked for less motion. The page carries the real
// numbers, so it reads without JavaScript.
import { useEffect, useRef, useState } from "react";
import { TrendingUp } from "lucide-react";
import { Apple, Windows } from "@/components/ui/BrandMarks";
import type { Stats as Numbers } from "@/lib/stats";

const COUNT_MS = 1800;
/** The dial always has this many ticks, whatever the number of days. */
const TICKS = 96;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const format = (n: number) => n.toLocaleString("en-US");

function useCount(value: number, run: boolean): number {
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
  return shown;
}

const dayName = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Each day is a run of ticks as tall as its downloads; the last 7 days are lit. */
function Dial({ days, from }: { days: number[]; from?: string }) {
  const top = Math.max(1, ...days);
  const ticks = Array.from({ length: TICKS }, (_, i) => {
    const d = Math.min(days.length - 1, Math.floor((i / TICKS) * days.length));
    return { level: days[d] / top, week: d >= days.length - 7, major: i % 8 === 0 };
  });
  return (
    <div className="dial" aria-hidden="true">
      <div className="dial-scale">
        {ticks.map((t, i) => (
          <i key={i} className={`${t.week ? "week" : ""}${t.major ? " major" : ""}`} style={{ ["--h" as string]: t.level.toFixed(3), ["--i" as string]: i }} />
        ))}
        <span className="needle" />
      </div>
      <div className="dial-ends">
        <span>{from ? dayName(from) : ""}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

function againstBefore(week: number, before: number | undefined): string | undefined {
  if (!before) return undefined;
  const r = week / before;
  if (r >= 2) return `${r.toFixed(1)}× the week before`;
  const pct = Math.round((r - 1) * 100);
  return pct === 0 ? "same as the week before" : `${pct > 0 ? "+" : ""}${pct}% on the week before`;
}

export function Stats({ numbers: n }: { numbers: Numbers }) {
  const ref = useRef<HTMLElement>(null);
  const [run, setRun] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setRun(true), io.disconnect()), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const total = useCount(n.npmTotal ?? 0, run);
  // Nothing could be read: no section, rather than a wrong number.
  if (!n.npmTotal) return null;
  const versus = n.npmWeek ? againstBefore(n.npmWeek, n.npmWeekBefore) : undefined;
  return (
    <section ref={ref} className={`section onair${run ? " run" : ""}`}>
      <div className="wrap">
        <p className="onair-tag">
          <span className="live" /> On the air
        </p>
        <b className="onair-num">{format(total)}</b>
        <p className="onair-what">npm downloads since the first version</p>
        {n.npmDaily && n.npmDaily.length > 1 && <Dial days={n.npmDaily} from={n.npmFrom} />}
        <div className="onair-chips">
          {!!n.npmWeek && (
            <span className="chip">
              <TrendingUp />
              <b>{format(n.npmWeek)}</b> this week{versus ? <em>{versus}</em> : null}
            </span>
          )}
          {!!n.appDownloads && (
            <span className="chip">
              <b>{format(n.appDownloads)}</b> app downloads
              <em>
                <Apple /> {format(n.macDownloads ?? 0)} <Windows /> {format(n.windowsDownloads ?? 0)}
              </em>
            </span>
          )}
        </div>
        <p className="onair-note">Downloads as npm and GitHub count them, not people. Updated with each release.</p>
      </div>
    </section>
  );
}
