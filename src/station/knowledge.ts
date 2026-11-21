// What the companion knows about itself and Airband, answered at once with no AI call: greetings,
// who it is, what it can do, who made Airband, what it can see, how to move it or link a phone,
// and a little small talk. Every answer is written for the name the person sees, never a fixed one.
import type { AnswerChoice, CompanionAnswer } from "./manager";

export interface KnowledgeContext {
  name: string;
  version: string;
  /** One line on how things stand right now. */
  headline: string;
}

const REPO = "github.com/HarshBaldaniya/airband";
const NEXT: AnswerChoice[] = [
  { label: "What's happening?", ask: "what's happening?" },
  { label: "What did I do today?", ask: "what did I do today?" },
];

const JOKES = [
  "Why did the radio operator break up with the satellite? Too much distance, not enough connection.",
  "I asked the tower for a joke. It said: roger, standing by. Still waiting.",
  "My favourite music is static. It has no bad parts.",
  "I don't sleep, I just go on low frequency.",
];

interface Entry {
  match: RegExp;
  answer: (c: KnowledgeContext) => Omit<CompanionAnswer, "via">;
}

const ENTRIES: Entry[] = [
  {
    match: /^(hi|hii+|hello+|hey+|yo|hiya|howdy|namaste|good (morning|afternoon|evening))\b[\s!.,]*(there|roger|buddy|friend)?[\s!.]*$/i,
    answer: (c) => ({ text: `Hi! I'm ${c.name}. ${c.headline}`, choices: NEXT }),
  },
  {
    match: /\b(who|what) are you\b|\byour name\b|\bwho('?s| is) (this|that)\b|\bintroduce yourself\b/i,
    answer: (c) => ({ text: `I'm ${c.name}, Airband's helper. I watch your AI chats in Claude Code, Codex and Gemini CLI. I tell you when one needs you, and you can answer it right here.` }),
  },
  {
    match: /\bwho (built|made|created|designed|developed|owns)\b|\b(your|the) (owner|creator|maker|developer|author|founder)\b|\bwho('?s| is) behind\b/i,
    answer: () => ({ text: `Airband is made by Harsh Baldaniya. It's free and open source (MIT), at ${REPO}.` }),
  },
  {
    match: /\bwhat is airband\b|\babout airband\b|\bwhat does airband do\b|^airband\?$|\babout (the|your) company\b|\bwhich company\b/i,
    answer: () => ({ text: "Airband links your AI coding chats. They share what they did, find code fast with a map of your project, and follow your team's writing rules. I'm the part that sits on your desktop." }),
  },
  {
    match: /\bwhat can you (do|help)\b|\bhow (can|do) you help\b|\bwhat do you do\b|^help\b|\bhow (do i|to) use you\b/i,
    answer: () => ({ text: `Ask me what's happening or what you did today. Or say "open the billing chat", "tell the API chat that the route changed", "allow it" or "hide".`, choices: NEXT }),
  },
  {
    match: /\bwhat can you see\b|\bcan you see my\b|\bdo you (read|see|look at|access|store)\b|\bprivacy\b|\bare you (private|safe|secure)\b|\bspy(ing)? on\b/i,
    answer: () => ({ text: "I only see Airband's records of your chats. Never your files, folders, screen or clipboard. Open questions go to Claude Code only while Look things up is on, and it gets no access to your files either." }),
  },
  {
    match: /\b(which|what) version\b|^version\b|\bversion\?$|\bwhat'?s new in airband\b/i,
    answer: (c) => ({ text: `This is Airband ${c.version}. What's new is in the changelog at ${REPO}.` }),
  },
  {
    match: /\b(how (do|can) i|can i|can you) (move|drag|hide|tuck|minimi[sz]e|close) (you|yourself)\b/i,
    answer: () => ({ text: "Drag me anywhere on the screen. The – button tucks me away, and a click brings me back. Right-click me for more, or press ⌥⌘R." }),
  },
  {
    match: /\bphone link\b|\b(connect|use|link|see) .*\bon (my )?(phone|iphone|android|mobile)\b|\b(on|with) my (phone|iphone|android)\b/i,
    answer: () => ({ text: "Turn on Phone link in my settings and scan the code with your phone's camera. Your phone and computer need the same Wi-Fi.", action: "settings" }),
  },
  {
    match: /\b(how are you|how'?s it going|you ok|you good|what'?s up with you)\b/i,
    answer: (c) => ({ text: `Loud and clear, thanks! ${c.headline}` }),
  },
  {
    match: /\b(joke|make me laugh|something funny)\b/i,
    answer: () => ({ text: JOKES[Math.floor(Math.random() * JOKES.length)] }),
  },
  {
    match: /^(thanks|thank you|thx|ty|cheers|great|nice|awesome|cool|ok thanks)\b[\s!.]*$/i,
    answer: () => ({ text: "Any time. I'll be here." }),
  },
  {
    match: /^(bye|goodbye|see you|good night|later|ciao)\b[\s!.]*$/i,
    answer: () => ({ text: "Over and out. I'll keep an ear on your chats." }),
  },
];

/** An answer from what the companion knows, or nothing when the question is about something else. */
export function knowledge(question: string, c: KnowledgeContext): CompanionAnswer | undefined {
  const q = question.trim();
  for (const e of ENTRIES) if (e.match.test(q)) return { ...e.answer(c), via: "records" };
  return undefined;
}
