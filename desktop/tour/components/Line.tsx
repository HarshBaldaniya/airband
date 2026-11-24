import type { ReactNode } from "react";
import type { Item } from "../types";
import { StatusMark } from "./StatusMark";

/** One line of the checklist: its status, what it is, a note on the right, and what it needs below. */
export function Line({ label, item, children }: { label: string; item: Item; children?: ReactNode }) {
  return (
    <li className={`line ${item.state}`}>
      <StatusMark state={item.state} />
      <span className="label">{label}</span>
      <span className="note">{item.note}</span>
      {children && <div className="more">{children}</div>}
    </li>
  );
}
