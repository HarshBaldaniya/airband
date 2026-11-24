import { ArrowUpRight, Eye, KeyRound, Lock, ServerOff } from "lucide-react";
import { HeroRoger } from "@/components/home/HeroRoger";
import { DownloadButton, InstallLine } from "@/components/download/DownloadButton";
import { HowItWorks } from "@/components/home/HowItWorks";
import { GitHub, Npm } from "@/components/ui/BrandMarks";
import { Reveal } from "@/components/layout/Reveal";
import { WaysIn } from "@/components/home/WaysIn";
import { Stats } from "@/components/home/Stats";
import { NEW_TAB } from "@/lib/links";
import { downloads, VERSION } from "@/lib/release";
import { SITE } from "@/lib/site";
import { stats } from "@/lib/stats";
import { JsonLd, faqGraph } from "@/lib/schema";

const AGENTS = [
  { name: "Claude Code", logo: "claudecode" },
  { name: "Codex", logo: "codex" },
  { name: "Gemini CLI", logo: "gemini" },
];

const FOUR = [
  { icon: <ServerOff />, title: "No account", line: "Nothing to sign up for" },
  { icon: <Eye />, title: "No telemetry", line: "Nothing about you is sent" },
  { icon: <KeyRound />, title: "No logins read", line: "Secrets are removed first" },
  { icon: <Lock />, title: "Locked iPhone link", line: "The relay can't read it" },
];

export default async function Home() {
  const [files, numbers] = await Promise.all([downloads(), stats()]);
  return (
    <>
      <JsonLd data={faqGraph()} />
      <section className="hero">
        <div className="wrap">
          <Reveal>
            <HeroRoger />
          </Reveal>
          <Reveal delay={0.1}>
            <h1>
              <span className="grad">Every AI agent,</span>
              <br />
              <span className="warm">on one frequency.</span>
            </h1>
          </Reveal>
          <Reveal delay={0.18}>
            <p className="line">Claude Code, Codex and Gemini CLI share what they did. Roger tells you the moment one needs you.</p>
          </Reveal>
          <Reveal delay={0.26}>
            <div className="actions">
              <DownloadButton />
              <InstallLine />
            </div>
          </Reveal>
          <Reveal delay={0.34}>
            <div className="agents" aria-label="Works with">
              <span className="with">Works with</span>
              {AGENTS.map((a) => (
                <span key={a.name}>
                  <img src={`/brand/agents/${a.logo}.svg`} alt="" width={20} height={20} />
                  {a.name}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <Stats numbers={numbers} />

      <section className="section" id="demo">
        <div className="wrap">
          <Reveal className="head">
            <h2 className="grad">How it works</h2>
            <p>One ear on every chat, so you never have to check them.</p>
          </Reveal>
          <Reveal delay={0.1}>
            <HowItWorks />
          </Reveal>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 32 }}>
        <div className="wrap">
          <Reveal className="head">
            <h2 className="grad">Stays on your computer</h2>
            <p>Your chats and your code never leave it.</p>
          </Reveal>
          <div className="four">
            {FOUR.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.08}>
                <div style={{ height: "100%" }}>
                  {f.icon}
                  <b className="one">{f.title}</b>
                  <span className="one">{f.line}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="get" style={{ paddingTop: 32 }}>
        <div className="wrap">
          <Reveal className="head">
            <h2 className="grad">Set up in a minute</h2>
            <p>Pick one. Each sets up every agent it finds.</p>
          </Reveal>
          <Reveal delay={0.1}>
            <WaysIn files={files} />
          </Reveal>
          <Reveal delay={0.2}>
            <div className="pills">
              <a className="pill" href={SITE.npm} {...NEW_TAB}>
                <Npm /> airband@{VERSION} <ArrowUpRight className="arrow" />
              </a>
              <a className="pill" href={SITE.repo} {...NEW_TAB}>
                <GitHub size={17} /> GitHub <ArrowUpRight className="arrow" />
              </a>
              <a className="pill" href={`${SITE.repo}/releases/tag/v${VERSION}`} {...NEW_TAB}>
                Release notes <ArrowUpRight className="arrow" />
              </a>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
