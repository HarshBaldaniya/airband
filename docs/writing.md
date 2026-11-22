[← Airband](../README.md)

# Writing rules for docs and messages

Airband gives agents short house rules when they write a doc or a message, and checks what they wrote.

AI agents now write many of a team's docs and messages. Airband gives them house rules, at the
moment they need them:

| When an agent is asked to … | Airband adds, once per chat |
|---|---|
| write a doc: a PRD, spec, README, guide, PR description or changelog | the **docs rules**: one idea per sentence, active voice, one name for one thing, no hype words, every fact and hedge kept, no lines crediting an AI tool |
| write a message: Slack, email, a PR or ticket comment, an announcement | the **message rules**: the point first, who does what by when, at most 5 items in a list, no empty greetings, no lines crediting an AI tool, a draft before sending |
| reply to you (off by default) | the **reply rules**: the answer or next action first, numbered steps, where things stand, no recap |

The rules are a few lines (about 150 tokens), sent only with an ask that needs them. The full rules
are the `airband-write-docs` and `airband-write-messages` skills. After an agent writes a doc file,
Airband checks the new text. It names long sentences, semicolons, hype words, two-word verbs,
filler, and lines such as "🤖 Generated with …" or "Co-Authored-By: Claude". What agents write goes
out in your name, so it reads as yours. The agent gets the list to fix, and you see one line:

```text
↪ Airband checked docs/prd.md: 2 long sentences (lines 14, 31), 1 hype word (line 9)
```

**Before it goes out.** Before an agent sends a Slack message, an email, a PR description, a
comment or a commit, Airband reads the words. If they break the rules, it holds the send once and
tells the agent what to fix. A commit is held only for a line crediting an AI tool. If the same
words come again unchanged, they go through, so a wording you asked for never gets stuck. This
works in Claude Code and Gemini CLI. In Codex, the rules still come with the ask.

```text
↪ Airband held a Slack message to fix first: 2 empty greetings or sign-offs (line 1)
```

Claude Code adds its own "Co-Authored-By: Claude" line to commits and "Generated with Claude Code"
to PRs, because its built-in instructions tell it to. `airband writing ai-credit off` turns that off
at the source, in Claude Code's own `attribution` setting. Airband backs up the settings file first,
and `ai-credit on` puts back whatever was there.

The **Writing** page in the VS Code extension has a switch for each of these.

```bash
airband writing                       # what is on
airband writing replies on            # short replies in every chat
airband writing before-send off       # don't check messages before they go out
airband writing ai-credit off         # Claude Code stops adding its AI-credit lines
airband writing check docs/*.md       # check files; exits 1 on findings, for CI
airband writing docs on --project     # the team's choice, in .airband.json
```

**For a team:** `--project` writes `.airband.json` at the project's root. Commit it, and everyone
who uses Airband in that project gets the same rules, in every agent. It can carry the team's own
rules too, and they are added after Airband's:

```json
{
  "writing": {
    "docs": true,
    "messages": true,
    "rules": ["Write British English.", "Name the owner of every action item."]
  }
}
```

The project's file wins over each person's setting. Your own writing skills and instructions win
over both. The docs rules follow the ideas of controlled-language writing (ASD-STE100, Simplified
Technical English). The message rules follow ADHD-friendly writing. Both are Airband's own short
versions.
