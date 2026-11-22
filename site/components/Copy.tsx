"use client";
// A command with a copy button. `show` can be shorter than what is copied.
import { Check, Copy as CopyIcon } from "lucide-react";
import { useState } from "react";

export function Copy({ text, show, small, block }: { text: string; show?: string; small?: boolean; block?: boolean }) {
  const [done, setDone] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    });
  return (
    <span className={`cmd mono${small ? " small" : ""}${block ? " block" : ""}`}>
      <span className="txt" title={text}>
        {show ?? text}
      </span>
      <button type="button" onClick={copy} aria-label={done ? "Copied" : `Copy ${text}`}>
        {done ? <Check /> : <CopyIcon />}
      </button>
    </span>
  );
}
