// Updates from connected chats on their way to a chat: how many, from whom, View and Sync.
import { send } from "../lib/vscode";
import { Eye, I, MessageSquareDot, RefreshCw } from "./Icons";

export function Incoming({ id, waiting, from, className = "" }: { id: string; waiting: number; from?: string[]; className?: string }) {
  return (
    <div className={`incoming nodrag ${className}`}>
      <div className="inhead">
        <span className="inicon" aria-hidden="true">
          <MessageSquareDot {...I} size={15} />
        </span>
        <span className="intext">
          <b>
            {waiting} update{waiting === 1 ? "" : "s"} on the way
          </b>
          <span className="insub">from {from?.join(", ") || "linked chats"}</span>
        </span>
      </div>
      <div className="inactions">
        <button className="btn tiny ghost" onClick={() => send({ type: "peek", id })}>
          <Eye {...I} size={12} /> View
        </button>
        <button className="btn tiny primary" onClick={() => send({ type: "syncNow", id })} data-tip="They arrive by themselves when the chat replies or gets its next message. Sync sends them now.">
          <RefreshCw {...I} size={12} /> Sync
        </button>
      </div>
    </div>
  );
}
