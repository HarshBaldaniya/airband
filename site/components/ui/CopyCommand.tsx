"use client";
// A command with a copy button. `show` can be shorter than what is copied.
import { Check, Copy as CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";

/** How long the check shows after a copy. */
const COPIED_MS = 1400;

export function CopyCommand({ text, show, small, block }: { text: string; show?: string; small?: boolean; block?: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [done]);
  const copy = () => void navigator.clipboard?.writeText(text).then(() => setDone(true));
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
