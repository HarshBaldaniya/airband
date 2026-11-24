import type { ReactNode } from "react";

/** One setting: a title, one short line under it, and its switch. Every row is the same shape. */
export function SettingRow({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="setrow">
      <span className="setlabel">
        {title}
        <small className="muted">{note}</small>
      </span>
      {children}
    </div>
  );
}
