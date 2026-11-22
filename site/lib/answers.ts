// What Roger can tell a visitor, in his own words. Matched on the visitor's words: no AI, nothing
// sent anywhere. Each answer can point somewhere, and the guide page opens the topic it names.
export interface Answer {
  id: string;
  ask: string;
  words: string[];
  say: string;
  go?: { label: string; href: string };
}

export const ANSWERS: Answer[] = [
  { id: "what", ask: "What do you do?", words: ["what", "do", "you", "who", "roger", "airband", "about", "how", "work"], say: "I listen to your Claude Code, Codex and Gemini CLI chats. When one needs you, I show it in the corner of your screen. When one finishes, I tell you what it did.", go: { label: "Watch me work", href: "/#demo" } },
  { id: "get", ask: "How do I get you?", words: ["get", "install", "download", "setup", "set", "start", "mac", "windows", "dmg", "exe"], say: "Download me for Mac or Windows. I'm about 3 MB, and I set everything up on first start. On any computer, npx airband works too.", go: { label: "Get Airband", href: "/download/" } },
  { id: "safe", ask: "Is it safe?", words: ["safe", "privacy", "private", "secure", "security", "data", "send", "upload", "code", "telemetry", "login", "token"], say: "Everything stays on your computer. No account, no telemetry, and I never read a login. Your iPhone link is locked end to end.", go: { label: "Privacy", href: "/privacy/" } },
  { id: "free", ask: "Is it free?", words: ["free", "cost", "price", "pay", "paid", "money", "license", "open", "source", "mit"], say: "Yes. Airband is free and open source under the MIT license, and it needs no account.", go: { label: "See the code", href: "https://github.com/HarshBaldaniya/airband" } },
  { id: "tokens", ask: "Does it cost tokens?", words: ["tokens", "token", "context", "expensive", "usage", "spend"], say: "Very few. A note between chats is one line per ask, and it rides on a message you were sending anyway. A code-map answer is a few hundred tokens instead of thousands." },
  { id: "iphone", ask: "Can I use my iPhone?", words: ["iphone", "phone", "mobile", "ios", "lock", "screen", "away", "push", "alert", "notification"], say: "Yes. Link it in my settings with one scan. Requests and finished chats reach your Lock Screen, and you can answer from there. One iPhone per Mac.", go: { label: "How to link it", href: "/docs/#iphone" } },
  { id: "connect", ask: "What does connecting chats do?", words: ["connect", "channel", "share", "sharing", "other", "chats", "between", "know", "copy", "paste"], say: "Connect two chats, and each gets a short note of what the other did, with your next message. No copying and pasting between windows.", go: { label: "Connecting chats", href: "/docs/#chats" } },
  { id: "agents", ask: "Which agents work?", words: ["agents", "agent", "claude", "codex", "gemini", "cursor", "vscode", "vs", "support", "supported", "linux"], say: "Claude Code, Codex and Gemini CLI, on macOS, Windows and Linux. Use one or all three." },
  { id: "warn", ask: "Why does my computer warn me?", words: ["warn", "warning", "smartscreen", "unsigned", "blocked", "gatekeeper", "open", "anyway", "trust", "virus"], say: "I'm not signed yet. On a Mac, open me once, then choose Open Anyway in Privacy & Security. On Windows, choose More info, then Run anyway.", go: { label: "First start", href: "/download/#first" } },
  { id: "node", ask: "Do I need Node.js?", words: ["node", "nodejs", "npm", "version", "old", "runtime"], say: "I run on Node.js 20 or newer. If yours is missing or old, the setup fetches my own copy and leaves yours as it is." },
  { id: "remove", ask: "How do I remove you?", words: ["remove", "uninstall", "delete", "stop", "quit"], say: "Run npx airband remove, quit me from my menu, then delete the app. I take my entries out of every agent.", go: { label: "Uninstall", href: "/docs/#remove" } },
];

/** Words in many questions: they count for little. */
const COMMON = new Set(["what", "do", "does", "you", "how", "work", "it", "is", "can", "open", "get", "set", "about"]);

const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1);

/** The answer that best fits what the visitor typed, if any fits. */
export function answerFor(text: string): Answer | undefined {
  const ws = tokens(text);
  if (!ws.length) return undefined;
  let best: Answer | undefined;
  let score = 0;
  for (const a of ANSWERS) {
    const s = ws.reduce((n, w) => n + (a.words.includes(w) ? (COMMON.has(w) ? 0.3 : 1) : 0), 0);
    if (s > score) (score = s), (best = a);
  }
  return score >= 0.8 ? best : undefined;
}

export const DONT_KNOW = "I don't know that one yet. The guide has the rest, or ask on GitHub.";
