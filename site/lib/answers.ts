// What Roger can tell a visitor, in his own words: no AI, nothing sent anywhere. Each answer can
// point somewhere, and the guide page opens the topic it names.
export interface Answer {
  id: string;
  ask: string;
  say: string;
  go?: { label: string; href: string };
}

export const ANSWERS: Answer[] = [
  { id: "what", ask: "What do you do?", say: "I listen to your Claude Code, Codex and Gemini CLI chats. When one needs you, I show it in the corner of your screen. When one finishes, I tell you what it did.", go: { label: "Watch me work", href: "/#demo" } },
  { id: "get", ask: "How do I get you?", say: "Download me for Mac or Windows. I'm about 3 MB, and I set everything up on first start. On any computer, npx airband works too.", go: { label: "Get Airband", href: "/download/" } },
  { id: "safe", ask: "Is it safe?", say: "Everything stays on your computer. No account, no telemetry, and I never read a login. Your iPhone link is locked end to end.", go: { label: "Privacy", href: "/privacy/" } },
  { id: "free", ask: "Is it free?", say: "Yes. Airband is free and open source under the MIT license, and it needs no account.", go: { label: "See the code", href: "https://github.com/HarshBaldaniya/airband" } },
  { id: "tokens", ask: "Does it cost tokens?", say: "Very few. A note between chats is one line per ask, and it rides on a message you were sending anyway. A code-map answer is a few hundred tokens instead of thousands." },
  { id: "iphone", ask: "Can I use my iPhone?", say: "Yes. Link it in my settings with one scan. Requests and finished chats reach your Lock Screen, and you can answer from there. One iPhone per Mac.", go: { label: "How to link it", href: "/docs/#iphone" } },
  { id: "connect", ask: "What does connecting chats do?", say: "Connect two chats, and each gets a short note of what the other did, with your next message. No copying and pasting between windows.", go: { label: "Connecting chats", href: "/docs/#chats" } },
  { id: "agents", ask: "Which agents work?", say: "Claude Code, Codex and Gemini CLI, on macOS, Windows and Linux. Use one or all three." },
  { id: "warn", ask: "Why does my computer warn me?", say: "I'm not signed yet. On a Mac, open me once, then choose Open Anyway in Privacy & Security. On Windows, choose More info, then Run anyway.", go: { label: "First start", href: "/download/#first" } },
  { id: "node", ask: "Do I need Node.js?", say: "I run on Node.js 20 or newer. If yours is missing or old, the setup fetches my own copy and leaves yours as it is." },
  { id: "remove", ask: "How do I remove you?", say: "Run npx airband remove, quit me from my menu, then delete the app. I take my entries out of every agent.", go: { label: "Uninstall", href: "/docs/#remove" } },
];
