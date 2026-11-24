// The Writing page: the switches for the rules agents get when they write, in two groups: how they
// write, and what is checked before anything goes out.
import { useEffect, useState } from "react";
import { BadgeCheck, FileText, MessageSquare, Reply, Send } from "lucide-react";
import type { WritingView } from "../../../src/vscode/protocol";
import { onMessage, send } from "../../lib/vscode";
import { I } from "../../components/Icons";

type Key = keyof WritingView["settings"];
type Item = { key: Key | "aiCredit"; icon: typeof FileText; title: string; what: string };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "How agents write",
    items: [
      { key: "docs", icon: FileText, title: "Docs", what: "PRDs, specs, READMEs and PR descriptions follow the docs rules." },
      { key: "messages", icon: MessageSquare, title: "Messages", what: "Slack posts, emails and comments follow the message rules." },
      { key: "replies", icon: Reply, title: "Short replies", what: "Chats answer first, in numbered steps, with no recap." },
    ],
  },
  {
    title: "Before it goes out",
    items: [
      { key: "beforeSend", icon: Send, title: "Check before sending", what: "A message, PR or commit that breaks the rules is held once to fix." },
      { key: "aiCredit", icon: BadgeCheck, title: "Hide AI credit lines", what: 'No "Co-Authored-By: Claude" in commits or "Generated with Claude Code" in PRs.' },
    ],
  },
];

export function WritingPage() {
  const [data, setData] = useState<WritingView | undefined>();

  useEffect(() => onMessage((m) => m.type === "writing" && setData(m.data)), []);
  useEffect(() => send({ type: "writing" }), []);

  // A project's committed .airband.json wins over these switches, so say when it does.
  const setBy = (k: Key) => data?.projects.find((p) => typeof p.team[k] === "boolean" && p.team[k] !== data.settings[k]);
  const isOn = (k: Item["key"]) => (k === "aiCredit" ? !data?.claudeAiCredit : !!data?.settings[k]);
  const toggle = (k: Item["key"], on: boolean) => send(k === "aiCredit" ? { type: "writingAiCredit", show: !on } : { type: "writingSet", key: k, on });

  return (
    <div className="usage writingpage">
      <div className="pagehead">
        <div>
          <h2>Writing</h2>
          <p className="muted small">Rules your agents follow when they write docs and messages.</p>
        </div>
      </div>

      {GROUPS.map((g) => (
        <section key={g.title} className="writinggroup">
          <h3 className="writinggrouptitle">{g.title}</h3>
          <div className="tile writingrules">
            {g.items.map((s) => {
              const team = s.key === "aiCredit" ? undefined : setBy(s.key);
              const on = isOn(s.key);
              return (
                <div key={s.key} className={`writingrow${on ? " on" : ""}`}>
                  <span className="writingicon">
                    <s.icon {...I} size={15} />
                  </span>
                  <div className="writingrowtext">
                    <b>{s.title}</b>
                    <span className="muted small">{s.what}</span>
                    {team && <span className="writingnote small">Turned {team.team[s.key as Key] ? "on" : "off"} by {team.name}'s .airband.json.</span>}
                  </div>
                  <button role="switch" aria-checked={on} aria-label={s.title} disabled={!data} className={`wtoggle${on ? " on" : ""}`} onClick={() => toggle(s.key, !on)}>
                    <span />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
