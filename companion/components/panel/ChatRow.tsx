// One chat in the panel: its agent and status, what it is doing, and Open. A working chat also
// takes a message, on the computer.
import { useState } from "react";
import { ExternalLink, MessageSquare, Send } from "lucide-react";
import { api, type LiveChat } from "../../api/station";
import { agentsRunning, ago } from "../../format";
import { sounds } from "../../sound";
import { AgentMark } from "../AgentMark";
import { TYPING } from "./typing";

const STATUS = { waiting: "Needs you", working: "Working", done: "Done", idle: "Quiet" } as const;

export function ChatRow({ chat, onSay }: { chat: LiveChat; onSay: (t: string) => void }) {
  const c = chat;
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const send = async () => {
    if (!text.trim()) return;
    try {
      const r = await api.tell(c.id, text.trim());
      onSay(`Sent to "${r.title}". ${r.when ?? "It gets your message with its next turn."}`);
      setText("");
      setWriting(false);
    } catch (e) {
      onSay(e instanceof Error ? e.message : String(e));
    }
  };
  const waiting = c.status === "waiting" && c.line;
  return (
    <li className={`chat ${c.status}${writing ? " open" : ""}`}>
      <div className="chatline">
        <span className="chatavatar" title={STATUS[c.status]}>
          <AgentMark agent={c.agent} size={16} />
          <span className={`statusdot ${c.status}`} aria-label={STATUS[c.status]} />
        </span>
        <span className="chattext">
          <b className="ellipsis">{c.title}</b>
          <span className={`chatmeta ellipsis${waiting ? " waiting" : ""}`}>{waiting ? c.line : `${c.project} · ${c.agents ? agentsRunning(c.agents) : ago(c.since)}`}</span>
        </span>
        <span className="rowactions">
          {/* Only a working chat takes a message straight away (its hook hands it over after the next
              step, or as it stops); any other would hold it until someone types there. */}
          {TYPING && c.status === "working" && (
            <button className="iconbtn" onClick={() => setWriting(!writing)} aria-label={`Message ${c.title}`} title="Message this chat">
              <MessageSquare size={14} />
            </button>
          )}
          <button className="iconbtn" onClick={() => (sounds.tick(), void api.open(c.id))} aria-label={`Open ${c.title}`} title={TYPING ? "Open this chat" : "Open it on your computer"}>
            <ExternalLink size={14} />
          </button>
        </span>
      </div>
      {TYPING && writing && c.status === "working" && (
        <form
          className="tell"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr" htmlFor={`tell-${c.id}`}>
            Message for {c.title}
          </label>
          <input id={`tell-${c.id}`} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell this chat…" />
          <button className="btn primary" type="submit" disabled={!text.trim()} aria-label="Send">
            <Send size={14} />
          </button>
        </form>
      )}
    </li>
  );
}
