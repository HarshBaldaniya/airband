// The Writing page: the rules agents get when they write a doc or a message, switched on and off
// here; each open project's team file (.airband.json); a file checked on the spot; and the latest
// things the checks found, each with a click to the line.
import { useEffect, useState } from "react";
import { BadgeCheck, ChevronDown, ChevronRight, FileCheck, FileText, MessageSquare, Reply, Send, ShieldCheck, Users } from "lucide-react";
import type { WritingFindingView, WritingView } from "../src/core/protocol";
import type { Tool } from "../src/core/types";
import { onMessage, send } from "./api";
import { I, ToolMark } from "./Icons";

type Key = keyof WritingView["settings"];

const SWITCHES: { key: Key; icon: typeof FileText; title: string; what: string }[] = [
  { key: "docs", icon: FileText, title: "Docs", what: "When a chat is asked for a PRD, a spec, a README or a PR description, it gets the docs rules. After an agent writes a doc file, Airband checks the new text." },
  { key: "messages", icon: MessageSquare, title: "Messages", what: "When a chat is asked for a Slack post, an email, a comment or an announcement, it gets the message rules." },
  { key: "beforeSend", icon: Send, title: "Check before sending", what: "Before an agent sends a message, a PR or a commit, Airband checks the words. If they break the rules, it holds the send once and tells the agent what to fix. The same words sent again go through." },
  { key: "replies", icon: Reply, title: "Short replies", what: "Every chat replies with the answer or the next action first, numbered steps and no recap." },
];

const RULE_NAME: Record<string, string> = {
  long: "Long sentence",
  semicolon: "Semicolon",
  hype: "Hype word",
  phrasal: "Two-word verb",
  filler: "Filler",
  pleasantry: "Empty greeting or sign-off",
  list: "List over 5 items",
  ai: "Credits an AI tool",
};

const TOOL: Record<string, Tool> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };

const when = (at: number) => {
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export function WritingPage() {
  const [data, setData] = useState<WritingView | undefined>();
  const [checked, setChecked] = useState<{ file: string; name: string; findings: WritingFindingView[] } | undefined>();
  const [open, setOpen] = useState<string | undefined>();

  useEffect(
    () =>
      onMessage((m) => {
        if (m.type === "writing") setData(m.data);
        if (m.type === "writingCheck") setChecked({ file: m.file, name: m.name, findings: m.findings });
      }),
    [],
  );
  useEffect(() => send({ type: "writing" }), []);

  if (!data) {
    return (
      <div className="usage writingpage">
        <div className="pagehead">
          <div>
            <h2>Writing</h2>
            <p className="muted small">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  const team = data.projects.find((p) => p.file);
  const brief = (k: Key) => (k === "docs" ? data.briefs.docs : k === "messages" ? data.briefs.messages : k === "replies" ? data.briefs.replies : undefined);

  return (
    <div className="usage writingpage">
      <div className="pagehead">
        <div>
          <h2>Writing</h2>
          <p className="muted small">Rules your agents get when they write a doc or a message, in Claude Code, Codex and Gemini CLI. A few lines, once per chat, only when an ask needs them. Your own writing rules and skills come first.</p>
        </div>
        <button className="btn small" onClick={() => send({ type: "writingCheck" })} data-tip="Pick a doc and see what breaks the rules">
          <FileCheck {...I} /> Check a file
        </button>
      </div>

      <section className="writingswitches">
        {SWITCHES.map((s) => {
          const on = data.settings[s.key];
          const fromTeam = team && typeof team.team[s.key] === "boolean" && team.team[s.key] !== on ? team.team[s.key] : undefined;
          const text = brief(s.key);
          return (
            <div key={s.key} className={`tile writingswitch${on ? " on" : ""}`}>
              <div className="writingswitchtop">
                <s.icon {...I} size={15} />
                <b>{s.title}</b>
                <span className="grow" />
                <button role="switch" aria-checked={on} aria-label={s.title} className={`ntpill${on ? " on" : ""}`} onClick={() => send({ type: "writingSet", key: s.key, on: !on })}>
                  {on ? "On" : "Off"}
                </button>
              </div>
              <p className="muted small">{s.what}</p>
              {fromTeam !== undefined && <p className="writingnote small">This project's .airband.json turns it {fromTeam ? "on" : "off"} for the team, and that wins here.</p>}
              {text && (
                <>
                  <button className="linkbtn small writingmore" onClick={() => setOpen(open === s.key ? undefined : s.key)} aria-expanded={open === s.key}>
                    {open === s.key ? <ChevronDown {...I} size={13} /> : <ChevronRight {...I} size={13} />} What the agent gets
                  </button>
                  {open === s.key && <pre className="writingbrief">{text}</pre>}
                </>
              )}
            </div>
          );
        })}
        <div className={`tile writingswitch${data.claudeAiCredit ? "" : " on"}`}>
          <div className="writingswitchtop">
            <BadgeCheck {...I} size={15} />
            <b>Claude Code's AI credit</b>
            <span className="grow" />
            <button role="switch" aria-checked={data.claudeAiCredit} aria-label="Claude Code's AI credit lines" className={`ntpill${data.claudeAiCredit ? "" : " on"}`} onClick={() => send({ type: "writingAiCredit", show: !data.claudeAiCredit })}>
              {data.claudeAiCredit ? "Shown" : "Hidden"}
            </button>
          </div>
          <p className="muted small">Claude Code adds "Co-Authored-By: Claude" to commits and "Generated with Claude Code" to PRs. Hide them so what you send reads as yours. This changes Claude Code's own setting, after a backup.</p>
        </div>
      </section>

      {checked && (
        <section className="tile writingchecked">
          <div className="writingsectiontitle">
            <FileCheck {...I} size={14} />
            <span>{checked.name}</span>
            <span className="grow" />
            <button className="btn tiny ghost" onClick={() => setChecked(undefined)}>
              Close
            </button>
          </div>
          {checked.findings.length ? <Findings findings={checked.findings} file={checked.file} /> : <p className="writingclean small">Reads clean: nothing breaks the docs rules.</p>}
        </section>
      )}

      <section className="tile">
        <div className="writingsectiontitle">
          <Users {...I} size={14} />
          <span>For your team</span>
        </div>
        <p className="muted small">Save these choices in the project's .airband.json and commit it. Everyone who works in the project gets the same rules, in every agent. Add the team's own rules to its "rules" list.</p>
        {data.projects.length ? (
          <div className="writingprojects">
            {data.projects.map((p) => (
              <div key={p.root} className="writingproject">
                <b className="ellipsis">{p.name}</b>
                {p.file ? (
                  <>
                    <span className="docbadge ok">
                      <ShieldCheck {...I} size={12} /> Team rules{p.rules.length ? ` · ${p.rules.length} of its own` : ""}
                    </span>
                    <span className="grow" />
                    <button className="btn tiny ghost" onClick={() => send({ type: "writingOpen", path: p.file! })}>
                      Open
                    </button>
                    <button className="btn tiny" onClick={() => send({ type: "writingTeam", root: p.root })} data-tip="Write the switches above into this file">
                      Update
                    </button>
                  </>
                ) : (
                  <>
                    <span className="muted small">No team file</span>
                    <span className="grow" />
                    <button className="btn tiny" onClick={() => send({ type: "writingTeam", root: p.root })}>
                      Save for the team
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">Open a project folder to save its team file.</p>
        )}
      </section>

      <section className="tile">
        <div className="writingsectiontitle">
          <FileText {...I} size={14} />
          <span>What the checks found</span>
        </div>
        {data.log.length ? (
          <ul className="writinglog">
            {data.log.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <details>
                  <summary>
                    <ToolMark tool={TOOL[e.agent] ?? "Claude"} size={12} />
                    <span className={`writingaction ${e.action}`}>{e.action === "held" ? "Held to fix" : "Asked to fix"}</span>
                    <b className="ellipsis">{e.what}</b>
                    <span className="muted small ellipsis">{e.summary}</span>
                    <span className="grow" />
                    <span className="muted small">{when(e.at)}</span>
                  </summary>
                  <Findings findings={e.findings} file={e.action === "fix" && e.cwd ? `${e.cwd}/${e.what}` : undefined} />
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Nothing yet. When an agent writes a doc or is about to send a message that breaks the rules, it shows here.</p>
        )}
      </section>
    </div>
  );
}

function Findings({ findings, file }: { findings: WritingFindingView[]; file?: string }) {
  return (
    <ul className="writingfindings">
      {findings.map((f, i) => (
        <li key={i}>
          {file ? (
            <button className="linkbtn writingline" onClick={() => send({ type: "writingOpen", path: file, line: f.line })}>
              line {f.line}
            </button>
          ) : (
            <span className="writingline muted">line {f.line}</span>
          )}
          <span className="writingrule">{RULE_NAME[f.rule] ?? f.rule}</span>
          <span className="ellipsis">{f.text}</span>
          {f.fix && <span className="muted small ellipsis">→ {f.fix}</span>}
        </li>
      ))}
    </ul>
  );
}
