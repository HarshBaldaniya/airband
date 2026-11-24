// The shapes the Station shares with its screens (the Airband app's corner, a browser, the iPhone
// app) and between its own parts. Types only, so the browser bundles can import them.
import type { AgentId } from "../core/agents";
import type { LiveChat } from "./chats";
import type { CompanionSettings } from "./companion";
import type { Answer, Question } from "./reply";

export interface PendingView {
  id: string;
  agent: AgentId;
  agentName: string;
  chatId?: string;
  chatTitle: string;
  project: string;
  cwd?: string;
  toolName?: string;
  title: string;
  detail?: string;
  /** The detail was too long to show whole: only its first 2000 characters (DETAIL_MAX) are in `detail`. */
  truncated?: true;
  /** The whole detail's length, when it was cut. */
  detailLength?: number;
  questions?: Question[];
  at: number;
  expiresAt: number;
  /** A pretend request to try the phone link (Test in the settings): no chat waits on it. */
  sample?: true;
}

export interface FinishedView {
  chatId: string;
  title: string;
  project: string;
  agent: AgentId;
  agentName: string;
  did?: string;
  open?: string;
  /** A summary for a notification, and whether the chat left the next step to you. */
  brief?: string;
  yours?: boolean;
  at: number;
}

export interface StationSettings {
  /** Permission requests come to the app. Off: every chat asks in its own terminal. */
  approvals: boolean;
  /** How long a request waits for a click before the terminal asks, in ms. */
  waitMs: number;
  /** The companion's name and look. */
  companion: CompanionSettings;
  /** Open questions may go to Claude Code (with Airband's records only). On unless turned off. */
  lookups: boolean;
  /** A linked phone hears every request and finished chat at once, even while you're at the computer.
   *  Off: only when you're away (the screen locked, or idle for a minute). */
  phoneAlways: boolean;
}

export interface StationState {
  version: string;
  now: number;
  headline: string;
  chats: LiveChat[];
  pending: PendingView[];
  finished: FinishedView[];
  settings: StationSettings;
  /** The phone link through Airband's relay: whether a phone is linked, and which. */
  link?: LinkStatus;
  /** How the latest test request was answered, and where ("none": nobody answered in time). */
  test?: { answer: string; from?: "phone" | "computer"; at: number };
}

export interface LinkStatus {
  /** An iPhone holds the link. */
  linked: boolean;
  /** A code is showing, waiting for an iPhone to scan it, until this time. */
  codeUntil?: number;
  /** The last code ran out before anyone scanned it. */
  expired?: boolean;
  /** The relay is reachable now. */
  online: boolean;
  phones: { name: string; at: number; alerts: boolean }[];
}

/** A button under an answer: pressing it asks this, so the person never has to type it. */
export interface AnswerChoice {
  label: string;
  ask: string;
}

export interface CompanionAnswer {
  text: string;
  /** The chat it is about, so the panel can offer to open it. */
  chatId?: string;
  /** When the ask could mean more than one thing: pick one. */
  choices?: AnswerChoice[];
  /** Something for the screen to do: tuck the companion away, open the settings. */
  action?: "tuck" | "settings";
  via: "records" | "claude" | "web" | "action";
}

/** What the phone link needs from the Station it serves (link.ts). */
export interface LinkedStation {
  on(event: "change" | "request" | "finished", listener: (...args: any[]) => void): unknown;
  off(event: "change" | "request" | "finished", listener: (...args: any[]) => void): unknown;
  snapshot(): StationState;
  /** Tells every screen that something changed. */
  changed(): void;
  decide(id: string, answer: Answer, from: "phone" | "computer"): boolean;
  dismiss(chatId: string): void;
  /** A pretend request, for Test in the settings. */
  sample(): PendingView;
}
