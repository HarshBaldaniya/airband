"use client";
// How it works: four steps on the left; on the right, Roger's corner drawn live, as the app draws
// it, so every word is sharp and things move. It moves on by itself (paused while the pointer is
// on it), and any step can be picked. Each scene starts fresh when its step comes up, so its
// animation plays from the beginning. The words are the app's own.
import { Check, Eye, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Companion } from "@/roger/companion/Companion";

const STEPS = [
  { title: "A chat needs you", line: "Allow it from the corner" },
  { title: "A chat is done", line: "What it did, in a sentence" },
  { title: "Chats share", line: "Each knows what the other did" },
  { title: "On your iPhone", line: "Requests reach you anywhere" },
];
const LENGTH = 6500;
const SUMMARY = "Seats now sync on every plan change. 6 new tests, all passing. Your turn: merge #128.";

function Corner({ mood, status, children }: { mood: "needs" | "done" | "hello"; status: string; children: React.ReactNode }) {
  return (
    <div className="mock">
      <div className="mock-head">
        <Companion mood={mood} name="Roger" size={60} count={mood === "needs" ? 1 : 0} />
        <div>
          <b>Roger</b>
          <span>{status}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

/** The agent's own window, behind Roger: what that chat is doing. */
function Win({ agent, logo, lines }: { agent: string; logo: string; lines: React.ReactNode }) {
  return (
    <div className="term back">
      <div className="t">
        <i />
        <i />
        <i />
        <img src={`/brand/agents/${logo}.svg`} alt="" /> {agent} · my-app
      </div>
      <pre>{lines}</pre>
    </div>
  );
}

function Needs() {
  return (
    <div className="desk">
      <Win
        agent="Claude Code"
        logo="claudecode"
        lines={
          <>
            <span className="dim">›</span> Add rate limiting to the login route{"\n\n"}
            <span className="ok">✓</span> Edited src/routes/login.ts{"\n"}
            <span className="ok">✓</span> Edited src/routes/login.test.ts{"\n\n"}
            <span className="wait">●</span> Waiting for permission{"\n"}
            <span className="dim">  npm test -- login</span>
          </>
        }
      />
      <div className="front">
    <Corner mood="needs" status="1 chat needs you.">
      <div className="mock-card needs">
        <div className="mock-meta">
          <i className="dot amber" />
          <img src="/brand/agents/claudecode.svg" alt="" />
          <b>my-app</b>
          <span>now</span>
        </div>
        <p className="mock-title">Wants to run a command</p>
        <code className="mock-code">npm test -- login</code>
        <div className="mock-allow">
          <span className="a">
            <Check /> Allow
          </span>
          <span className="a done">
            <Check /> Allowed. Running the tests
          </span>
        </div>
        <div className="mock-two">
          <span>
            <Check /> Always
          </span>
          <span>
            <X /> Deny
          </span>
        </div>
      </div>
      <svg className="cursor" viewBox="0 0 24 24" aria-hidden>
        <path d="M4 2l15 9-6.6 1.4L16 20l-2.6 1.3-3.6-7.6L4 18z" fill="#fff" stroke="#000" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </Corner>
      </div>
    </div>
  );
}

function Done() {
  const words = SUMMARY.split(" ");
  return (
    <div className="desk">
      <Win
        agent="Codex"
        logo="codex"
        lines={
          <>
            <span className="dim">›</span> Fix the seat count when a plan changes{"\n\n"}
            <span className="ok">✓</span> syncSeats runs after checkout and renewal{"\n"}
            <span className="ok">✓</span> 6 new tests, all passing{"\n\n"}
            <span className="dim">  Done in 4m 12s</span>
          </>
        }
      />
      <div className="front">
    <Corner mood="done" status="Nothing needs you. 1 finished just now.">
      <div className="mock-card ok">
        <div className="mock-meta">
          <i className="dot green" />
          <img src="/brand/agents/codex.svg" alt="" />
          <b>Fix the seat count</b>
          <span>now</span>
        </div>
        <p className="mock-sub">my-app</p>
        <p className="mock-text">
          {words.map((w, i) => (
            <span key={i} style={{ animationDelay: `${600 + i * 70}ms` }}>
              {w}{" "}
            </span>
          ))}
        </p>
        <div className="mock-row">
          <span className="g">
            <Eye /> Review
          </span>
          <span>Later</span>
        </div>
      </div>
    </Corner>
      </div>
    </div>
  );
}

function Share() {
  return (
    <div className="desk">
      <div className="term back">
        <div className="t">
          <i />
          <i />
          <i />
          <img src="/brand/agents/codex.svg" alt="" /> Codex · my-app
        </div>
        <pre>
          <span className="dim">›</span> Fix the seat count when a plan changes{"\n\n"}
          <span className="ok">✓</span> Seats now sync on every plan change{"\n"}
          <span className="ok">✓</span> 6 new tests, all passing
        </pre>
      </div>
      <svg className="link" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path id="beam-path" d="M 44 46 C 52 62, 58 62, 66 64" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="front wide">
        <div className="term arrive">
          <div className="t">
            <i />
            <i />
            <i />
            <img src="/brand/agents/gemini.svg" alt="" /> Gemini CLI · my-app
          </div>
          <pre>
            <span className="ok">✓</span> Airband · sharing with “Fix the seat count”{"\n"}
            <span className="air">↪</span> Airband added what “Fix the seat count” did to this message
          </pre>
        </div>
      </div>
    </div>
  );
}

function Phone() {
  const notes = [
    { title: "my-app needs you", body: "Wants to run npm test -- login" },
    { title: "Fix the seat count is done", body: "Your turn: merge #128" },
  ];
  return (
    <div className="desk">
      <Win
        agent="Claude Code"
        logo="claudecode"
        lines={
          <>
            <span className="dim">›</span> Add rate limiting to the login route{"\n\n"}
            <span className="wait">●</span> Waiting for permission{"\n"}
            <span className="dim">  npm test -- login</span>{"\n\n"}
            <span className="air">↪</span> Airband sent it to your iPhone
          </>
        }
      />
      <div className="front phone-front">
    <div className="iphone">
      <div className="island" />
      <div className="lock">
        <span className="day">Saturday 22 November</span>
        <span className="time">9:41</span>
      </div>
      <div className="notes">
        {notes.map((n, i) => (
          <div key={n.title} className="note" style={{ animationDelay: `${0.6 + i * 1.4}s` }}>
            <img src="/brand/icon.png" alt="" />
            <div>
              <div className="app">
                <span>AIRBAND</span>
                <small>now</small>
              </div>
              <b className="one">{n.title}</b>
              <span className="one">{n.body}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="lock-btns" aria-hidden>
        <i />
        <i />
      </div>
      <div className="home" />
    </div>
      </div>
    </div>
  );
}

const SCENES = [Needs, Done, Share, Phone];

export function HowItWorks() {
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setAt((i) => (i + 1) % STEPS.length), LENGTH);
    return () => clearTimeout(t);
  }, [at, paused]);
  const Scene = SCENES[at];
  return (
    <div className={`how${paused ? " paused" : ""}`} style={{ ["--t" as string]: `${LENGTH}ms` }} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      <div className="list">
        {STEPS.map((s, i) => (
          <button key={s.title} type="button" className={`step${i === at ? " on" : ""}`} onClick={() => setAt(i)} aria-pressed={i === at}>
            <span className="n">0{i + 1}</span>
            <span>
              <b className="one">{s.title}</b>
              <small className="one">{s.line}</small>
            </span>
            <i className="bar" key={i === at ? `on-${at}` : "off"} />
          </button>
        ))}
      </div>
      <div className="stage" role="img" aria-label={`${STEPS[at].title}: ${STEPS[at].line}`}>
        <div className="how-scene" key={at}>
          <Scene />
        </div>
      </div>
    </div>
  );
}
