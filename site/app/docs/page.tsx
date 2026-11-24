import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Cable, Headphones, LifeBuoy, Rocket, Smartphone, SquareTerminal, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { CopyCommand } from "@/components/ui/CopyCommand";
import { InstallLine } from "@/components/download/DownloadButton";
import { Reveal } from "@/components/layout/Reveal";
import { Toc } from "@/components/docs/Toc";

export const metadata: Metadata = { title: "Guide", description: "Get started with Airband, meet Roger, link your iPhone and fix what isn't right. One short page.", alternates: { canonical: "/docs/" } };

const SECTIONS = [
  { id: "start", title: "Get started" },
  { id: "roger", title: "Roger on your screen" },
  { id: "chats", title: "Connect chats" },
  { id: "iphone", title: "Link your iPhone" },
  { id: "commands", title: "The airband command" },
  { id: "help", title: "Something's not right" },
  { id: "remove", title: "Uninstall" },
];

const START = [
  { title: "Paste the line", line: "In Terminal or PowerShell" },
  { title: "Roger opens", line: "In a corner of your screen" },
  { title: "Follow the tour", line: "It connects your agents" },
];

const MAC = (
  <>
    <kbd>⌥</kbd> <kbd>⌘</kbd> <kbd>R</kbd>
  </>
);

const ROGER: { title: string; line: ReactNode }[] = [
  { title: "A chat needs you", line: "He shows the request: Allow, Always or Deny" },
  { title: "A chat is done", line: "He says what it did, and Review opens it" },
  { title: "Move him", line: "Drag him anywhere. The – button tucks him away" },
  { title: "Show or hide him", line: <>{MAC} on a Mac, <kbd>Alt</kbd> <kbd>Ctrl</kbd> <kbd>R</kbd> on Windows</> },
];

const LEVELS = [
  { name: "Ping", line: "One line per ask", tag: "Default" },
  { name: "Brief", line: "What was asked, done and still open" },
  { name: "Full", line: "The reply in its own words" },
];

const COMMANDS = [
  { cmd: "airband doctor", line: "Check everything, with the fix" },
  { cmd: "airband update", line: "Move to the newest version" },
  { cmd: 'airband find "x"', line: "Where something is in your code" },
  { cmd: "airband standup", line: "What your chats did since yesterday" },
  { cmd: "airband help", line: "Every command" },
];

const HELP: { when: string; fix: ReactNode }[] = [
  { when: "An agent isn't connected", fix: <>Run <code>airband doctor</code>. It checks every agent and says what to fix.</> },
  { when: "Roger is missing", fix: <>Press {MAC}, or choose <strong>Set up Airband…</strong> in the menu bar.</> },
  { when: "A newer version is out", fix: <>The app updates its parts by itself. For the app, choose <strong>Update</strong> in its menu or Roger&apos;s panel.</> },
  { when: "You found a bug", fix: <><code>airband bug</code> opens a GitHub issue with your system filled in.</> },
];

function Part({ id, icon, title, children }: { id: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section id={id} className="gs">
      <div className="gs-head">
        <span className="gs-ico">{icon}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function Guide() {
  return (
    <div className="page">
      <div className="wrap">
        <Reveal className="head">
          <h1 className="grad">Guide</h1>
          <p>Everything you need, on one page.</p>
        </Reveal>
        <Toc items={SECTIONS} chips />
        <div className="gd">
          <aside>
            <Toc items={SECTIONS} />
          </aside>
          <article>
            <Part id="start" icon={<Rocket />} title="Get started">
              <ol className="gs-steps">
                {START.map((s, i) => (
                  <li key={s.title}>
                    <span className="n">{i + 1}</span>
                    <span>
                      <b>{s.title}</b>
                      <span>{s.line}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="gs-install">
                <InstallLine />
              </div>
              <div className="gs-more">
                <Link href="/download/">
                  Download the file instead <ArrowUpRight />
                </Link>
                <span>
                  Only the agents: <code>npx airband</code>
                </span>
              </div>
            </Part>

            <Part id="roger" icon={<Headphones />} title="Roger on your screen">
              <div className="gs-tiles">
                {ROGER.map((r) => (
                  <div key={r.title}>
                    <b>{r.title}</b>
                    <span>{r.line}</span>
                  </div>
                ))}
              </div>
            </Part>

            <Part id="chats" icon={<Cable />} title="Connect chats">
              <ol className="gs-list">
                <li>In VS Code&apos;s Tower, drag one chat&apos;s card onto another.</li>
                <li>When one finishes a reply, the other gets a short note with your next message.</li>
              </ol>
              <div className="gs-tiles three">
                {LEVELS.map((l) => (
                  <div key={l.name}>
                    <b>
                      {l.name}
                      {l.tag && <em>{l.tag}</em>}
                    </b>
                    <span>{l.line}</span>
                  </div>
                ))}
              </div>
            </Part>

            <Part id="iphone" icon={<Smartphone />} title="Link your iPhone">
              <ol className="gs-list">
                <li>
                  In Roger&apos;s settings, choose <strong>Link</strong> next to <strong>Your phone</strong>.
                </li>
                <li>Scan the code with your iPhone&apos;s camera.</li>
                <li>Add Airband to your Home Screen and open it. It links by itself.</li>
              </ol>
              <p className="gs-note">The code works once, for 10 minutes. One iPhone per Mac. Alerts need iOS 16.4 or later.</p>
            </Part>

            <Part id="commands" icon={<SquareTerminal />} title="The airband command">
              <div className="gs-rows">
                {COMMANDS.map((c) => (
                  <div key={c.cmd}>
                    <code className="mono">{c.cmd}</code>
                    <span>{c.line}</span>
                  </div>
                ))}
              </div>
            </Part>

            <Part id="help" icon={<LifeBuoy />} title="Something's not right">
              <div className="gs-rows wide">
                {HELP.map((h) => (
                  <div key={h.when}>
                    <b>{h.when}</b>
                    <span>{h.fix}</span>
                  </div>
                ))}
              </div>
            </Part>

            <Part id="remove" icon={<Trash2 />} title="Uninstall">
              <ol className="gs-list">
                <li>
                  Take Airband out of every agent. Add <code>--purge</code> to delete its data too.
                </li>
                <li>Quit Airband from its menu, then delete the app.</li>
              </ol>
              <CopyCommand text="npx airband remove" />
            </Part>
          </article>
        </div>
      </div>
    </div>
  );
}
