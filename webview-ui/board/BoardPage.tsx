// The board: one editor tab with the Tower, Fuel, the Map, Commands and Writing, a key for each,
// and the sheet of shortcuts (? on any page).
import { useState } from "react";
import { Orbit, PenLine, SquareSlash } from "lucide-react";
import type { BoardTab } from "../../src/vscode/protocol";
import { useViewState } from "../app/ViewStateContext";
import { BarChart3, I, Keyboard, LayoutGrid, Zap } from "../components/Icons";
import { KeySheet } from "../components/KeySheet";
import { typing } from "../lib/keys";
import { LAYER, useKeys } from "../lib/useKeys";
import { send } from "../lib/vscode";
import { CommandsPage } from "../pages/commands/CommandsPage";
import { FuelPage } from "../pages/fuel/FuelPage";
import { MapPage } from "../pages/map/MapPage";
import { WritingPage } from "../pages/writing/WritingPage";
import { PAGE_KEYS } from "./page-keys";
import { Tower } from "./tower/Canvas";

/** Each tab, the key that opens it, and whether its name gives way to its icon on a narrow board. */
const TABS = [
  { tab: "board", key: "t", Icon: LayoutGrid, label: "Tower", tip: "Tower (T)", folds: false },
  { tab: "usage", key: "u", Icon: BarChart3, label: "Fuel", tip: "Fuel (U)", folds: false },
  { tab: "code", key: "m", Icon: Orbit, label: "Map", tip: "Map of the code (M)", folds: true },
  { tab: "library", key: "c", Icon: SquareSlash, label: "Commands", tip: "Commands for your agents (C)", folds: true },
  { tab: "writing", key: "e", Icon: PenLine, label: "Writing", tip: "Writing rules for your agents (E)", folds: true },
] as const;

export function BoardPage({ tab, setTab }: { tab: BoardTab; setTab: (t: BoardTab) => void }) {
  const state = useViewState();
  const [keysOpen, setKeysOpen] = useState(false);
  useKeys(LAYER.tabs, (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.key === "?") return (setKeysOpen((v) => !v), true);
    const to = TABS.find((t) => t.key === e.key.toLowerCase());
    if (!to) return false;
    setTab(to.tab);
    return true;
  });
  // The sheet is in front of everything: its Esc closes it and nothing else.
  useKeys(LAYER.sheet, (e) => e.key === "Escape" && (setKeysOpen(false), true), keysOpen);
  return (
    <div className="boardpage">
      <div className="boardtop">
        <div className="seg big" role="tablist">
          {TABS.map(({ tab: t, Icon, label, tip, folds }) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)} data-tip={tip}>
              <Icon {...I} /> {folds ? <span className="tablabel">{label}</span> : label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className={`keysbtn${keysOpen ? " on" : ""}`} onClick={() => setKeysOpen((v) => !v)} data-tip="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" aria-expanded={keysOpen}>
          <Keyboard {...I} size={15} />
        </button>
        {!state.hooksOn && (
          <button className="btn small primary" onClick={() => send({ type: "setup" })}>
            <Zap {...I} /> Turn on auto-sharing
          </button>
        )}
      </div>
      {keysOpen && <KeySheet sections={PAGE_KEYS[tab]} close={() => setKeysOpen(false)} />}
      {tab === "usage" ? <FuelPage /> : tab === "code" ? <MapPage /> : tab === "library" ? <CommandsPage /> : tab === "writing" ? <WritingPage /> : <Tower />}
    </div>
  );
}
