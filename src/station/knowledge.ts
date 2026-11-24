// What the companion knows about itself and Airband, answered at once with no AI call: greetings,
// who it is, what it can do, who made Airband, what it can see, how to move it or link a phone,
// and a little small talk. Every answer is written for the name the person sees, never a fixed one.
import type { AnswerChoice, CompanionAnswer } from "./types";

export interface KnowledgeContext {
  name: string;
  /** The part of the question being answered (set by knowledge()). */
  question?: string;
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

const ABOUT_ME: AnswerChoice[] = [
  { label: "What can you do?", ask: "what can you do?" },
  { label: "Who built you?", ask: "who built you?" },
];
const FUN: AnswerChoice[] = [
  { label: "Where do you live?", ask: "where do you live?" },
  { label: "Tell me a joke", ask: "tell me a joke" },
];

const ENTRIES: Entry[] = [
  {
    match: /^(hi|hii+|hello+|hey+|yo|hiya|howdy|namaste|good (morning|afternoon|evening))\b[\s!.,]*(there|roger|buddy|friend)?[\s!.]*$/i,
    answer: (c) => ({ text: `Hi! I'm ${c.name}. ${c.headline}`, choices: NEXT }),
  },
  {
    // Who it is, and what it is not: Airband's own helper, never a model or another company's.
    match: /\b(who|what) are you\b|\byour name\b|\bwho('?s| is) (this|that)\b|\bintroduce yourself\b|\btell me about yourself\b|\bare you (claude|chatgpt|gpt|gemini|an? (ai|bot|robot|llm|model))\b|\b(which|what) (ai|model|llm)\b|\bpowered by\b|\bwhat (runs|powers) you\b/i,
    answer: (c) => ({ text: `I'm ${c.name}, Airband's helper, built by Harsh Baldaniya. I sit on your desktop, keep an ear on your AI chats in Claude Code, Codex and Gemini CLI, and tell you the moment one needs you. You can answer it right here.`, choices: ABOUT_ME }),
  },
  {
    match: /\bwho (built|builds|build|made|makes|created|creates|designed|developed|coded|wrote|owns) (you|airband|this|roger)\b|\bwho (built|made|created|designed|developed|owns)\b|\b(your|the) (owner|creator|maker|developer|author|founder|dad|father|parent|boss)\b|\bwho('?s| is) behind\b/i,
    answer: () => ({ text: `Harsh Baldaniya built me, and all of Airband. It's free and open source, at ${REPO}.` }),
  },
  {
    match: /\b(do you know|who is|who'?s|tell me about|about) harsh\b|\bharsh baldaniya\b/i,
    answer: (c) => ({ text: `Of course: Harsh Baldaniya is the one who built me, ${c.name}, and all of Airband. He makes tools for people who work with AI coding chats every day. Airband is free and open source, at ${REPO}.` }),
  },
  {
    match: /\bwhere (do|are|did) you (live|lived|living|stay|staying|from|come from|born)\b|\bwhere are you\b|\byour (home|house|address)\b|\bwhere.*\blived?\b/i,
    answer: (c) => ({ text: `Right here, in the corner of your screen. My home is your Mac: I live inside the Airband app, and everything I know stays on this computer. ${c.name === "Roger" ? "On a quiet day you'll find me napping here." : ""}`.trim(), choices: FUN }),
  },
  {
    match: /\bhow old are you\b|\byour age\b|\bwhen (were you|was airband) (born|made|built)\b|\byour birthday\b/i,
    answer: (c) => ({ text: `I'm brand new: version ${c.version} of Airband. Every update, I learn a few new tricks.` }),
  },
  {
    match: /\bwhy (are you|is your name|the name|named|called) ?(roger)?\b.*\b(roger|name)\b|\bwhy roger\b|\bwhat does roger mean\b|\bmeaning of (your name|roger)\b/i,
    answer: (c) => ({ text: c.name === "Roger" ? `"Roger" is what radio operators say for "message received". Airband is about chats talking to each other, so I'm the one who says "roger that" when one needs you.` : `You named me ${c.name}, and I like it. My first name was Roger: radio talk for "message received".` }),
  },
  {
    match: /\bare you (real|human|a person|alive|a robot|robot)\b|\bare you sentient\b|\bdo you have feelings\b/i,
    answer: () => ({ text: "I'm a small helper made of code, a headset and a lot of good intentions. Not a person, but I do take my job seriously: keeping an ear on your chats." }),
  },
  {
    match: /\bdo you (sleep|dream|rest|get tired)\b|\bare you (asleep|sleeping|tired)\b/i,
    answer: () => ({ text: "When every chat is done and it's quiet for a couple of minutes, I take a nap. A new chat, a request or your pointer wakes me right up." }),
  },
  {
    match: /\bfavou?rite (food|colou?r|song|music|movie|film|thing|place|word)\b|\bwhat do you (like|love|eat)\b/i,
    answer: (c) => {
      const q = c.question ?? "";
      const about = /colou?r/i.test(q) ? "colour" : /food|eat/i.test(q) ? "food" : /song|music/i.test(q) ? "music" : /movie|film/i.test(q) ? "movie" : /place/i.test(q) ? "place" : "thing";
      const say: Record<string, string> = {
        colour: "Orange, obviously. Look at me.",
        food: "Fresh bytes, lightly cached. And the occasional cookie your browser forgot.",
        music: "Static, gently. And the sound of a test suite passing.",
        movie: "Anything about mission control. Big screens, calm voices, everyone saying \"roger\".",
        place: "This corner of your screen. Great view of your chats.",
        thing: "A clean build on the first try. Rare, so I treasure it.",
      };
      return { text: say[about], choices: FUN };
    },
  },
  {
    match: /\bcan you (sing|dance|rap)\b|\bsing (me )?(a song|something)\b/i,
    answer: () => ({ text: "♪ Roger, roger, chats are done, all your tests have passed and run ♪ …I'll stick to watching your chats." }),
  },
  {
    match: /\b(i love you|you('?re| are) (cute|nice|awesome|the best|great|cool))\b/i,
    answer: () => ({ text: "Aw, you're making my antenna glow. I'm here whenever a chat needs you." }),
  },
  {
    match: /\bwhat('?s| is) the time\b|\bwhat time is it\b|\bcurrent time\b/i,
    answer: () => ({ text: `It's ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` }),
  },
  {
    match: /\bwhat('?s| is) (the )?(date|day) today\b|\btoday'?s date\b|\bwhat day is it\b/i,
    answer: () => ({ text: `It's ${new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.` }),
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
    answer: () => ({ text: "I see Airband's records of your chats: what they're doing, what they asked and what they finished. Never your files, folders, screen or clipboard. Ask me \"what's happening?\" any time." }),
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
    answer: () => ({ text: "Open my settings and choose Link next to Your phone, then scan the code with your iPhone's camera. Add Airband to your Home Screen and open it there: it links by itself. It's for your Mac and one iPhone, and everything between them is locked.", action: "settings" }),
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

/** Chat-speak spelled out, so "who r u" and "where do u live" are understood like their full words. */
function spellOut(q: string): string {
  return q
    .replace(/\bu\b/gi, "you")
    .replace(/\bur\b/gi, "your")
    .replace(/\br\b/gi, "are")
    .replace(/\by\b(?=\s+(are|is|do|did)\b)/gi, "why")
    .replace(/\b(wat|wht|wut)\b/gi, "what")
    .replace(/\babt\b/gi, "about")
    .replace(/\b(plz|pls)\b/gi, "please")
    .replace(/\bbuilds\b/gi, "built")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * An answer from what the companion knows, or nothing when the question is about something else.
 * Two questions in one ("who built you? and where do you live?") get both answers, in order.
 */
export function knowledge(question: string, c: KnowledgeContext): CompanionAnswer | undefined {
  const q = spellOut(question);
  const parts = q.split(/[?!.]+\s*(?:and\s+)?|\s+and\s+(?=(?:who|what|where|why|how|when|do|are|can|tell)\b)/i).map((x) => x.trim()).filter(Boolean);
  const hits: Omit<CompanionAnswer, "via">[] = [];
  const used = new Set<Entry>();
  for (const part of parts.length > 1 ? parts : [q]) {
    const e = ENTRIES.find((x) => !used.has(x) && x.match.test(part));
    if (e) {
      used.add(e);
      hits.push(e.answer({ ...c, question: part }));
    }
  }
  if (!hits.length) return undefined;
  // A part it did not understand goes to a look-up instead, so nothing asked is left out.
  if (parts.length > 1 && hits.length < parts.length) return undefined;
  return { text: hits.map((h) => h.text).join(" "), ...(hits.at(-1)?.choices ? { choices: hits.at(-1)!.choices } : {}), ...(hits.find((h) => h.action)?.action ? { action: hits.find((h) => h.action)!.action } : {}), via: "records" };
}
