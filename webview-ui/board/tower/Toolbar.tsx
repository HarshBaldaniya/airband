// The Tower's toolbar: the chat list, the search, the arrangements, focus, clear and a new chat.
import { useRef, useState, type RefObject } from "react";
import { Panel } from "@xyflow/react";
import { useViewState } from "../../app/ViewStateContext";
import { useDismiss } from "../../lib/useDismiss";
import { send } from "../../lib/vscode";
import { CalendarDays, ChevronDown, Eraser, FolderTree, I, LayoutDashboard, Maximize2, Minimize2, Network, PanelLeftClose, PanelLeftOpen, Plus, Search } from "../../components/Icons";
import { ARRANGE_LABEL, type ArrangeMode } from "./layout";

const ARRANGEMENTS = [
  ["links", Network, "By channels", "Who shares with whom, left to right"],
  ["time", CalendarDays, "By time", "Today, yesterday, this week, older"],
  ["agent", LayoutDashboard, "By agent", "Claude, Codex, Gemini"],
  ["folder", FolderTree, "By folder", "One row per project, channels across them"],
] as const;

export function Toolbar(p: {
  trayOpen: boolean;
  toggleTray: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: (q: string) => void;
  matchCount: number;
  findMatches: () => void;
  hasCards: boolean;
  arrangeMode: ArrangeMode | "free";
  arrange: (mode: ArrangeMode) => void;
  toggleFocus: () => void;
}) {
  const { focus } = useViewState();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuOpen, menuRef, () => setMenuOpen(false));
  const live = p.arrangeMode !== "free";
  return (
    <Panel position="top-left" className="toolbar">
      <button className="tbtn" onClick={p.toggleTray} data-tip={p.trayOpen ? "Hide the chat list (L)" : "Show the chat list (L)"} aria-label={p.trayOpen ? "Hide the chat list" : "Show the chat list"}>
        {p.trayOpen ? <PanelLeftClose {...I} size={15} /> : <PanelLeftOpen {...I} size={15} />}
      </button>
      <span className="tsep" />
      <label className="tsearch">
        <Search {...I} size={14} />
        <input
          ref={p.searchRef}
          placeholder="Find a chat"
          value={p.query}
          onChange={(e) => p.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") p.findMatches();
            if (e.key === "Escape") {
              p.setQuery("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Find a chat on the Tower"
        />
        {p.query.trim() && <span className="tcount">{p.matchCount}</span>}
      </label>
      <span className="tsep" />
      <div className="tmenuwrap" ref={menuRef}>
        <button className="tbtn" onClick={() => setMenuOpen((v) => !v)} disabled={!p.hasCards} aria-expanded={menuOpen} data-tip="Lay the cards out (1 channels · 2 time · 3 agent · 4 folder)">
          <LayoutDashboard {...I} size={15} />{" "}
          <span className="tlabel">
            Arrange{live ? <span className="tmode"> · {ARRANGE_LABEL[p.arrangeMode as ArrangeMode]}</span> : null}
          </span>{" "}
          <ChevronDown {...I} size={12} />
        </button>
        {menuOpen && (
          <div className="tmenu" role="menu">
            {ARRANGEMENTS.map(([mode, Icon, label, hint]) => (
              <button
                key={mode}
                role="menuitemradio"
                aria-checked={p.arrangeMode === mode}
                className={p.arrangeMode === mode ? "on" : ""}
                onClick={() => {
                  setMenuOpen(false);
                  p.arrange(mode);
                }}
              >
                <Icon {...I} size={14} />
                <span>
                  {label}
                  <small>{hint}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        className={`tbtn ${focus ? "on" : ""}`}
        onClick={p.toggleFocus}
        data-tip={focus ? "Leave focus: bring the side panels back (Esc or F)" : "Focus: give the Tower the whole window (F)"}
        aria-label={focus ? "Leave focus" : "Focus"}
      >
        {focus ? <Minimize2 {...I} size={15} /> : <Maximize2 {...I} size={15} />}
        <span className="tlabel">{focus ? "Exit focus" : "Focus"}</span>
      </button>
      {p.hasCards && (
        <button className="tbtn" onClick={() => send({ type: "boardClear" })} data-tip="Take every card off the Tower (Undo brings them back)" aria-label="Clear the Tower">
          <Eraser {...I} size={15} /> <span className="tlabel">Clear</span>
        </button>
      )}
      <span className="tsep" />
      <button className="tbtn" onClick={() => send({ type: "newChat", tool: "Claude" })} data-tip="New Claude chat (N)">
        <Plus {...I} size={15} /> <span className="tlabel">New chat</span>
      </button>
    </Panel>
  );
}
