// The rules, short: what a chat gets, once, when an ask needs them.
import { PROJECT_FILE, type WritingKind, type WritingSettings } from "./settings";

export const DOCS_BRIEF = [
  "Airband's writing rules for docs (PRDs, specs, READMEs, guides, PR descriptions, changelogs, error and UI text). The project's or the person's own writing rules come first.",
  "- One idea per sentence: at most 20 words for an instruction, 25 for a description.",
  "- Active voice: say who does what. Simple tenses (\"the job failed\", not \"the job has been failing\").",
  "- One name for one thing, every time. Define a term the reader may not know, once.",
  "- Plain verbs: \"start\", not \"kick off\". \"Check\", not \"perform a check of\".",
  "- No semicolons. No hype words (\"seamless\", \"robust\", \"powerful\"): give the number or the fact instead.",
  "- Write as the person, for people: no \"Generated with\" or \"Co-Authored-By\" lines naming an AI tool, no robot emoji, no \"As an AI\".",
  "- Steps are a numbered list, one action per step. One topic per paragraph.",
  "- Keep every fact, condition, number and hedge (\"may\", \"can\"). Add no claim the source does not make.",
  "Full rules: the airband-write-docs skill.",
].join("\n");

export const MESSAGES_BRIEF = [
  "Airband's writing rules for messages (Slack, email, PR and ticket comments, announcements). The project's or the person's own rules come first.",
  "- The first line is the point or the ask. Then one line of context, if needed.",
  "- Say who does what by when: a name and a date for each action.",
  "- Steps are a numbered list. At most 5 items in a list, the most important first.",
  "- One topic per message; details go in a thread or behind a link.",
  "- No greetings or sign-offs that say nothing (\"Hope you're well\", \"Let me know if you need anything\"), no \"by the way\" sidebars, no idioms.",
  "- Write as the person: no \"Generated with\" lines or other credit to an AI tool, no robot emoji, nothing that says an AI wrote it.",
  "- Show the person the draft before you send or post it.",
  "Full rules: the airband-write-messages skill.",
].join("\n");

export const REPLIES_BRIEF = [
  "The person asked Airband for short replies they can act on. For every reply in this chat (their own instructions win where they differ):",
  "1. Start with the answer or the next action. No preamble (\"Great question\", \"Let me …\").",
  "2. Number steps, one action each.",
  "3. Say where things stand: \"Step 2 of 4 done: … Next: …\".",
  "4. Give times in real units (\"about 10 minutes\"), not \"a bit of work\".",
  "5. At most 5 items per list, the most important first; offer the rest.",
  "6. Finish the task first; name a side issue at the end, as one question.",
  "7. No recap of what you did and no closing offer (\"Hope this helps\").",
  "When asked to explain, explain in full, with headings. Before anything that deletes or overwrites, ask.",
].join("\n");

const DOCS_ASK = /\b(prds?|specs?|specifications?|readmes?|docs?|documentation|documents?|design docs?|rfcs?|adrs?|changelogs?|release notes|write-?ups?|guides?|runbooks?|playbooks?|how-?tos?|proposals?|one-?pagers?|pr (description|body)|wiki|faq)\b/i;
const MESSAGES_ASK = /\b(slack|emails?|e-mails?|mails?|messages?|dms?|reply to|respond to|announce(ment)?|post (it |this )?(in|on|to)|tell (the )?team|standup|stand-up|status update|comment on|pr comments?|review comments?|tweet|linkedin post|whatsapp|teams message)\b/i;

/** Which rules an ask needs, among those switched on. */
export function writingFor(prompt: string | undefined, s: WritingSettings): ("docs" | "messages")[] {
  if (!prompt) return [];
  const p = prompt.slice(0, 4000);
  const out: ("docs" | "messages")[] = [];
  if (s.docs && DOCS_ASK.test(p)) out.push("docs");
  if (s.messages && MESSAGES_ASK.test(p)) out.push("messages");
  return out;
}

/** The text a chat gets for these kinds, with the team's own rules after them. */
export function briefFor(kinds: WritingKind[], s: WritingSettings): string {
  const parts = kinds.map((k) => (k === "docs" ? DOCS_BRIEF : k === "messages" ? MESSAGES_BRIEF : REPLIES_BRIEF));
  if (s.rules.length && kinds.some((k) => k !== "replies")) parts.push(`This team's own writing rules (from ${PROJECT_FILE}):\n${s.rules.map((r) => `- ${r}`).join("\n")}`);
  return parts.join("\n\n");
}
