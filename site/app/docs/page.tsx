import type { Metadata } from "next";
import { Copy } from "@/components/Copy";
import { Reveal } from "@/components/Reveal";
import { Toc } from "@/components/Toc";

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

export default function Guide() {
  return (
    <div className="page">
      <div className="wrap">
        <Reveal className="head">
          <h1 className="grad">Guide</h1>
          <p>Everything you need, on one page.</p>
        </Reveal>
        <div className="doc">
          <aside>
            <Toc items={SECTIONS} />
          </aside>
          <article>
            <section id="start">
              <h2>Get started</h2>
              <ol>
                <li>Download the app for Mac or Windows, or run the command below in a terminal.</li>
                <li>Open it. The first time, allow it once: it isn't signed yet.</li>
                <li>Follow the tour. It finds your AI tools, fetches what's missing and connects them.</li>
              </ol>
              <Copy text="npx airband" />
            </section>

            <section id="roger">
              <h2>Roger on your screen</h2>
              <ul>
                <li><strong>A chat needs you:</strong> Roger shows the request. Choose Allow, Always or Deny.</li>
                <li><strong>A chat is done:</strong> he says what it did. Review opens it.</li>
                <li><strong>Move him</strong> by dragging. The <strong>–</strong> button tucks him away.</li>
                <li><kbd>⌥</kbd> <kbd>⌘</kbd> <kbd>R</kbd> shows or hides him. On Windows, <kbd>Alt</kbd> <kbd>Ctrl</kbd> <kbd>R</kbd>.</li>
              </ul>
            </section>

            <section id="chats">
              <h2>Connect chats</h2>
              <ol>
                <li>In VS Code's Tower, drag one chat's card onto another.</li>
                <li>When one finishes a reply, the other gets a short note with your next message.</li>
                <li>Pick how much it gets: <strong>Ping</strong> (one line per ask), <strong>Brief</strong> or <strong>Full</strong>.</li>
              </ol>
            </section>

            <section id="iphone">
              <h2>Link your iPhone</h2>
              <ol>
                <li>In Roger's settings, choose <strong>Link</strong> next to <strong>Your phone</strong>.</li>
                <li>Scan the code with your iPhone's camera.</li>
                <li>Add Airband to your Home Screen and open it. It links by itself.</li>
              </ol>
              <p className="aside">The code works once, for 10 minutes. One iPhone per Mac. Alerts need iOS 16.4 or later.</p>
            </section>

            <section id="commands">
              <h2>The airband command</h2>
              <pre>{`airband doctor      check everything, with the fix
airband update      move to the newest version
airband find "x"    where something is in your code
airband standup     what your chats did since yesterday
airband help        every command`}</pre>
            </section>

            <section id="help">
              <h2>Something's not right</h2>
              <ul>
                <li>Run <code>airband doctor</code>. It checks every agent and says what to fix.</li>
                <li>Roger missing? Press <kbd>⌥</kbd> <kbd>⌘</kbd> <kbd>R</kbd>, or choose <strong>Set up Airband…</strong> in his menu.</li>
                <li><code>airband bug</code> opens a GitHub issue with your system filled in.</li>
              </ul>
            </section>

            <section id="remove">
              <h2>Uninstall</h2>
              <ol>
                <li>Run <code>npx airband remove</code>. Add <code>--purge</code> to delete its data too.</li>
                <li>Quit Airband from its menu, then delete the app.</li>
              </ol>
            </section>
          </article>
        </div>
      </div>
    </div>
  );
}
