import { useEffect, useRef, useState } from "react";
import { agoText } from "../lib/format";
import { useDismiss } from "../lib/useDismiss";
import { Check, Folder, FolderOpen, I, ListFilter, Search, X } from "../components/Icons";
import type { FolderInfo } from "./grouping";

/**
 * Which folders "All folders" shows: a filter button at the end of the tabs, opening a list
 * over the chats (it never pushes them down). Built for many folders: a search that is ready to
 * type, the newest first with when each was last active, a scrolling list, and quick choices.
 * Every tick applies at once; a click outside or Esc closes it.
 */
export function FolderPicker({ folders, hidden, setHidden, root }: { folders: FolderInfo[]; hidden: string[]; setHidden: (v: string[]) => void; root?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false), { onBlur: true });
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  const shown = folders.filter((f) => !hidden.includes(f.path)).length;
  const needle = q.trim().toLowerCase();
  // By the folder's name (or the parent that tells two same-named folders apart).
  const list = folders.filter((f) => !needle || f.name.toLowerCase().includes(needle) || (f.hint ?? "").toLowerCase().includes(needle));
  const toggle = (p: string) => setHidden(hidden.includes(p) ? hidden.filter((x) => x !== p) : [...hidden, p]);
  const allOn = shown === folders.length;
  const onlyHere = !!root && shown === 1 && !hidden.includes(root);
  const none = shown === 0;
  return (
    <div className="fpicker" ref={ref}>
      <button
        className={`ffilter ${allOn ? "" : "some"} ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={allOn ? "Choose folders" : `Showing ${shown} of ${folders.length} folders`}
      >
        <ListFilter {...I} size={14} />
        {!allOn && (
          <span className="ffcount">
            {shown}/{folders.length}
          </span>
        )}
      </button>
      {open && (
        <div className="fpop" role="dialog" aria-label="Folders to show">
          <div className="fpophead">
            <span className="fpoptitle">Show folders</span>
            <div className="fquick" role="group" aria-label="Quick choice">
              <button className={allOn ? "on" : ""} aria-pressed={allOn} onClick={() => setHidden([])}>
                All
              </button>
              {root && (
                <button className={onlyHere ? "on" : ""} aria-pressed={onlyHere} onClick={() => setHidden(folders.map((f) => f.path).filter((p) => p !== root))}>
                  Current only
                </button>
              )}
              <button className={none ? "on" : ""} aria-pressed={none} onClick={() => setHidden(folders.map((f) => f.path))}>
                None
              </button>
            </div>
          </div>
          <div className="searchrow fsearch">
            <Search {...I} className="muted" size={13} />
            <input autoFocus className="search" placeholder={`Find among ${folders.length} folders`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a folder" />
            {q && (
              <button className="icon sm" aria-label="Clear" onClick={() => setQ("")}>
                <X {...I} size={12} />
              </button>
            )}
          </div>
          <div className="flist">
            {list.map((f) => {
              const on = !hidden.includes(f.path);
              const here = f.path === root;
              return (
                <label key={f.path} className={`fitem ${on ? "on" : ""}`} data-tip={f.path}>
                  <input type="checkbox" checked={on} onChange={() => toggle(f.path)} />
                  <span className="fcheck" aria-hidden="true">
                    {on && <Check {...I} size={11} strokeWidth={3} />}
                  </span>
                  {here ? <FolderOpen {...I} size={13} className="fitemicon here" /> : <Folder {...I} size={13} className="fitemicon" />}
                  <span className="fitemtext">
                    <span className="fitemname">
                      <span className="fname ellipsis">{f.name}</span>
                      {f.hint && <span className="fhint ellipsis">{f.hint}</span>}
                    </span>
                    <span className="fitemmeta">{f.latest ? agoText(f.latest) : ""}</span>
                  </span>
                  <span className="count">{f.count}</span>
                </label>
              );
            })}
            {!list.length && <p className="muted small fnone">No folder matches “{q.trim()}”.</p>}
          </div>
          <div className="fpopfoot">
            <span className="muted">
              {shown} of {folders.length} shown
            </span>
            <span className="grow" />
            {!allOn && (
              <button className="linkish" onClick={() => setHidden([])}>
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
