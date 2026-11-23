// /llms.txt (llmstxt.org): the site in plain Markdown for language models and answer engines,
// from the same facts as the pages.
import { ANSWERS } from "@/lib/answers";
import { changelog, VERSION } from "@/lib/release";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  const [latest] = changelog();
  const text = [
    "# Airband",
    "",
    `> ${SITE.description}`,
    "",
    `Airband is free and open source (MIT), built by ${SITE.author.name} (${SITE.author.url}). It works with Claude Code, Codex and Gemini CLI on macOS, Windows and Linux. It needs no account, sends no telemetry and never reads a login.`,
    "",
    "## Install",
    "",
    `- Desktop app for Mac and Windows, about 3 MB: ${SITE.origin}/download/ (version ${VERSION})`,
    "- Any computer with Node.js 20 or newer: `npx airband`",
    "- Claude Code plugin: `/plugin install airband --marketplace HarshBaldaniya/airband`",
    "",
    "## What it does",
    "",
    "- Connects chats: when one finishes a reply, every chat connected to it gets a short note with its next message (what was asked, what was done, which files changed).",
    "- Roger, the desktop companion, shows a chat's request (Allow, Always or Deny) and what a finished chat did.",
    "- iPhone alerts, locked end to end so the relay cannot read them. One iPhone per Mac.",
    "- A code map and three MCP tools (airband_map, airband_flightlog, airband_notes), under 400 tokens of definitions, and 15 skills agents use by themselves.",
    "",
    "## Questions and answers",
    "",
    ...ANSWERS.flatMap((a) => [`### ${a.ask}`, "", a.say, ""]),
    latest ? `## What's new in ${latest.version}` : "",
    "",
    ...(latest ? latest.items.map((i) => `- ${i.replace(/\*\*/g, "").replace(/\n/g, "\n  ")}`) : []),
    "",
    "## Links",
    "",
    `- [Website](${SITE.origin})`,
    `- [Guide](${SITE.origin}/docs/)`,
    `- [Source on GitHub](${SITE.repo})`,
    `- [npm package](${SITE.npm})`,
    `- [Privacy](${SITE.origin}/privacy/)`,
    "",
  ].join("\n");
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
