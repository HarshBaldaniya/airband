// The project on the Map: its name, and with more than one, a short list to switch.
import { useRef, useState } from "react";
import { Check, ChevronsUpDown, FolderGit2, FolderPlus } from "lucide-react";
import type { CodeMapView } from "../../../src/vscode/protocol";
import { useDismiss } from "../../lib/useDismiss";
import { send } from "../../lib/vscode";
import { I } from "../../components/Icons";

/** A path with the home folder as ~. */
export const home = (p: string) => p.replace(/^\/(Users|home)\/[^/]+/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");

export function ProjectPicker({ data, name, pick }: { data: CodeMapView; name: string; pick: (root: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  // This window's projects first, then the others, with a line between; then any other folder.
  const here = data.projects.filter((p) => p.here);
  const others = data.projects.filter((p) => !p.here);
  const row = (p: CodeMapView["projects"][number]) => (
    <button
      key={p.root}
      className={`projrow${p.root === data.root ? " on" : ""}`}
      role="option"
      aria-selected={p.root === data.root}
      data-tip={home(p.root)}
      onClick={() => {
        setOpen(false);
        if (p.root !== data.root) pick(p.root);
      }}
    >
      <span className="ellipsis">{p.name}</span>
      {p.root === data.root && <Check {...I} size={14} />}
    </button>
  );
  return (
    <div className="projpick" ref={ref}>
      <button className="projbtn" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} aria-label={`Project: ${name}`} data-tip={home(data.root)}>
        <FolderGit2 {...I} size={15} className="projicon" />
        <span className="projname ellipsis">{name}</span>
        <ChevronsUpDown {...I} size={14} className="projchev" />
      </button>
      {open && (
        <div className="projmenu" role="listbox" aria-label="Projects">
          {here.map(row)}
          {here.length > 0 && others.length > 0 && <div className="menusep" />}
          {others.map(row)}
          <div className="menusep" />
          <button
            className="projrow projadd"
            onClick={() => {
              setOpen(false);
              send({ type: "codeMapFolder" });
            }}
          >
            <span>Map another folder…</span>
            <FolderPlus {...I} size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
