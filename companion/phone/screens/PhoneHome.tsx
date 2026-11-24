// The phone app's home: what needs you (with big Allow / Always / Deny), what is working, and what
// finished today with a short summary of what it did. Nothing here opens or reviews a chat: that is
// done on the computer.
import { useState } from "react";
import type { FinishedView, LiveChat, PendingView, StationState } from "../../api/station";
import { AgentMark } from "../../components/AgentMark";
import { RequestCard } from "../../components/cards/RequestCard";
import { Companion } from "../../figure/Companion";
import type { Mood } from "../../figure/types";
import { agentsRunning, ago } from "../../format";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One short line under the big one: what else is going on. */
function subline(working: number, done: number): string {
  const parts = [working ? `${working} working` : "", done ? `${done} done today` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing running right now.";
}

function Hero({ state, up, mood, name, design }: { state: StationState; up: boolean; mood: Mood; name: string; design?: string }) {
  const needs = state.pending.length;
  const working = state.chats.filter((c) => c.status === "working").length;
  const done = finishedToday(state).length;
  const big = !up ? "Your computer is offline" : needs ? `${plural(needs, "chat")} ${needs === 1 ? "needs" : "need"} you` : working ? "Working on it" : "All quiet";
  return (
    <section className={`hero${needs ? " needs" : ""}`}>
      <Companion mood={up ? mood : "resting"} name={name} design={design} size={84} count={needs} />
      <div className="herotext">
        <h1>{big}</h1>
        <p className="muted">{up ? subline(working, done) : "Requests wait there until it's back."}</p>
      </div>
    </section>
  );
}

/** What finished today: from the computer's "finished" list, and the chats that ended today. */
interface DoneEntry {
  id: string;
  title: string;
  project: string;
  agent: string;
  /** Its summary: the outcome, then key points, one per line. */
  did?: string;
  /** It left the next step to you. */
  yours?: boolean;
  at: number;
}

function finishedToday(state: StationState): DoneEntry[] {
  const start = new Date(state.now);
  start.setHours(0, 0, 0, 0);
  const seen = new Set<string>();
  const out: DoneEntry[] = [];
  for (const f of state.finished as FinishedView[]) {
    if (f.at < start.getTime() || seen.has(f.chatId)) continue;
    seen.add(f.chatId);
    const did = f.brief ?? f.did;
    out.push({ id: f.chatId, title: f.title, project: f.project, agent: f.agent, ...(did ? { did } : {}), ...(f.yours ? { yours: true } : {}), at: f.at });
  }
  for (const c of state.chats as LiveChat[]) {
    if (c.status !== "done" || c.since < start.getTime() || seen.has(c.id)) continue;
    seen.add(c.id);
    const did = c.lastBrief ?? c.lastDid;
    out.push({ id: c.id, title: c.title, project: c.project, agent: c.agent, ...(did ? { did } : {}), ...(c.yours ? { yours: true } : {}), at: c.since });
  }
  return out.sort((a, b) => b.at - a.at);
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="psection">
      <h2>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function DoneItem({ item }: { item: DoneEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="pitem done" onClick={() => setOpen(!open)}>
      <span className="pmark">
        <AgentMark agent={item.agent} size={18} />
      </span>
      <span className="ptext">
        <span className="ptop">
          <b className="ellipsis">{item.title}</b>
          <span className="muted">{ago(item.at)}</span>
        </span>
        {(item.project !== item.title || item.yours) && (
          <span className="pproj">
            {item.yours && <span className="yourturn">Your turn</span>}
            {item.project !== item.title && <span className="muted">{item.project}</span>}
          </span>
        )}
        {item.did ? <span className={`psum${open ? " open" : ""}`}>{item.did}</span> : <span className="psum muted">Finished.</span>}
      </span>
    </li>
  );
}

function WorkingItem({ chat }: { chat: LiveChat }) {
  return (
    <li className="pitem working">
      <span className="pmark">
        <AgentMark agent={chat.agent} size={18} />
        <span className="pulse" aria-hidden="true" />
      </span>
      <span className="ptext">
        <span className="ptop">
          <b className="ellipsis">{chat.title}</b>
          <span className="muted">{ago(chat.since)}</span>
        </span>
        <span className="muted pproj ellipsis">{chat.agents ? `${chat.project} · ${agentsRunning(chat.agents)}` : chat.lastAsk && chat.lastAsk !== chat.title ? chat.lastAsk : chat.project}</span>
      </span>
    </li>
  );
}

export function PhoneHome({ state, up, mood, name, design, onError, afterHero }: { state: StationState; up: boolean; mood: Mood; name: string; design?: string; onError: (m: string) => void; afterHero?: React.ReactNode }) {
  const pending = state.pending as PendingView[];
  const working = state.chats.filter((c) => c.status === "working");
  const done = finishedToday(state);
  return (
    <>
      <Hero state={state} up={up} mood={mood} name={name} design={design} />
      {afterHero}
      {!!pending.length && (
        <Section title="Needs you" count={pending.length}>
          <div className="requests">
            {pending.map((p) => (
              <RequestCard key={p.id} request={p} onError={onError} />
            ))}
          </div>
        </Section>
      )}
      {!!working.length && (
        <Section title="Working" count={working.length}>
          <ul className="plist">
            {working.map((c) => (
              <WorkingItem key={c.id} chat={c} />
            ))}
          </ul>
        </Section>
      )}
      <Section title="Done today" count={done.length}>
        {done.length ? (
          <ul className="plist">
            {done.slice(0, 20).map((d) => (
              <DoneItem key={d.id} item={d} />
            ))}
          </ul>
        ) : (
          <p className="muted pempty">Nothing finished yet today.</p>
        )}
      </Section>
    </>
  );
}
