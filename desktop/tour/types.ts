// What the app tells the tour. Mirrors the Rust side: Found and Scan in src-tauri/src/setup/scan.rs,
// and what connect_agents answers (src-tauri/src/commands.rs).

export interface Found {
  name: string;
  found: boolean;
  detail?: string | null;
  link: string;
}

export interface Scan {
  os: "mac" | "windows" | "linux";
  node?: string | null;
  node_ok: boolean;
  node_min: number;
  own_node: boolean;
  engine?: string | null;
  agents: Found[];
  editors: Found[];
}

export interface Connected {
  agents: string[];
  codexTrust: boolean;
  list: { id: string; name: string; tools: boolean; sharing: boolean }[];
  command?: string | null;
}

/** A line of the checklist: waiting its turn, working, done, needing the person, or failed. */
export type State = "waiting" | "working" | "done" | "needs" | "failed";
export type Key = "computer" | "node" | "engine" | "connect";

export interface Item {
  state: State;
  /** What it says on the right: a version, how far, what's wrong. */
  note?: string;
}

/** What the checklist found, for the last screen. */
export interface Result {
  scan: Scan;
  items: Record<Key, Item>;
}
