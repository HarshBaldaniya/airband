"use client";
// Roger at the top of the page, live. His bubble goes through what he does in a day on its own,
// his mood with it; the three questions under it make him answer instead. His eyes follow the
// pointer. No box and no typing: he shows, and he answers what you pick.
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Companion } from "@/roger/companion/Companion";
import type { Mood } from "@/roger/companion/types";
import { setSoundsOn } from "@/roger/sound";
import { ANSWERS, type Answer } from "@/lib/answers";
import { NEW_TAB } from "@/lib/links";

const DAY: { mood: Mood; say: string }[] = [
  { mood: "hello", say: "Hi, I'm Roger. I listen to your AI coding chats." },
  { mood: "needs", say: "Billing fix needs you: run npm test?" },
  { mood: "working", say: "Running the tests in Billing fix." },
  { mood: "done", say: "Billing fix is done. Your turn: merge #128." },
  { mood: "talking", say: "Shared what it did with your Gemini chat." },
];
const PICKS = ["what", "safe", "free"];

export function HeroRoger() {
  const [at, setAt] = useState(0);
  const [answer, setAnswer] = useState<Answer>();
  const [thinking, setThinking] = useState(false);
  const [look, setLook] = useState({ dx: 0, dy: 0 });
  // A moment of his own: a wave when the pointer comes to him, dizzy when clicked.
  const [react, setReact] = useState<{ mood: Mood; say: string }>();
  const reactTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const me = useRef<HTMLDivElement>(null);

  useEffect(() => setSoundsOn(false), []);
  // His day, one line every few seconds, until someone asks him something.
  useEffect(() => {
    if (answer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setAt((i) => (i + 1) % DAY.length), 3600);
    return () => clearTimeout(t);
  }, [at, answer]);
  useEffect(() => {
    let raf = 0;
    const on = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = me.current?.getBoundingClientRect();
        if (!r) return;
        const c = (v: number) => Math.max(-1, Math.min(1, v));
        setLook({ dx: c((e.clientX - (r.left + r.width / 2)) / 420), dy: c((e.clientY - (r.top + r.height / 2)) / 320) });
      });
    };
    window.addEventListener("pointermove", on, { passive: true });
    return () => (window.removeEventListener("pointermove", on), cancelAnimationFrame(raf));
  }, []);

  const reactFor = (r: { mood: Mood; say: string }, ms: number) => {
    clearTimeout(reactTimer.current);
    setReact(r);
    reactTimer.current = setTimeout(() => setReact(undefined), ms);
  };

  // An answer stays 12 seconds, long enough to read, then he goes back to his day. Where the
  // pointer is doesn't matter: on a phone a tap never "leaves".
  useEffect(() => {
    if (!answer) return;
    const t = setTimeout(() => setAnswer(undefined), 12000);
    return () => clearTimeout(t);
  }, [answer]);

  const pick = (a: Answer) => {
    setReact(undefined);
    setThinking(true);
    setTimeout(() => (setThinking(false), setAnswer(a)), 600);
  };

  const mood: Mood = thinking ? "thinking" : react ? react.mood : answer ? "talking" : DAY[at].mood;
  const text = react ? react.say : answer ? answer.say : DAY[at].say;
  const words = text.split(" ");
  return (
    <div className="hr">
      <button
        type="button"
        className={`hr-me${mood === "needs" ? " urgent" : ""}`}
        ref={me as unknown as React.RefObject<HTMLButtonElement>}
        aria-label="Roger"
        onPointerEnter={() => !answer && reactFor({ mood: "hello", say: "Oh, hi! Ask me something below." }, 2600)}
        onClick={() => reactFor({ mood: "dizzy", say: "Whoa, that tickles. I'm fine, really." }, 2200)}
      >
        <div className="rings" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <span className="float">
          <Companion mood={mood} name="Roger" size={116} look={look} count={mood === "needs" ? 1 : 0} />
        </span>
      </button>
      <div className="hr-talk">
        <div className="hr-bubble" aria-live="polite">
          {thinking ? (
            <span className="dots" aria-label="Roger is thinking">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <span key={text}>
              {words.map((w, i) => (
                <span key={i} className="w" style={{ animationDelay: `${i * 40}ms` }}>
                  {w}{" "}
                </span>
              ))}
              {!react && answer?.go &&
                (answer.go.href.startsWith("http") ? (
                  <a className="go" href={answer.go.href} style={{ animationDelay: `${words.length * 40 + 100}ms` }} {...NEW_TAB}>
                    {answer.go.label} <ArrowRight />
                  </a>
                ) : (
                  <Link className="go" href={answer.go.href} style={{ animationDelay: `${words.length * 40 + 100}ms` }}>
                    {answer.go.label} <ArrowRight />
                  </Link>
                ))}
            </span>
          )}
        </div>
        <div className="hr-asks">
          {PICKS.map((id) => {
            const a = ANSWERS.find((x) => x.id === id)!;
            return (
              <button key={id} type="button" className={`chip${answer?.id === id ? " on" : ""}`} onClick={() => pick(a)}>
                {a.ask}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
