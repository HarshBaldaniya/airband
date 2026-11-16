---
name: airband-write-messages
description: Write messages people can read in seconds and act on, such as Slack posts, DMs, emails, PR and ticket comments, announcements and status updates. It puts the point first, says who does what by when, and keeps lists short. Use when drafting, rewriting or sending any message.
---

# Write messages people can act on

Readers skim. Many read on a phone between other work, and some have ADHD. A message works when the
first line alone tells them what you need. If the person, team or project has its own message rules
or skill, follow those first.

## The shape

1. **First line: the point or the ask.** "Can you review #128 by Thursday?" Do not start with
   background.
2. **Context: one or two lines,** only what the reader needs to act.
3. **Actions: who, what, by when.** One line each, with a name and a date.
4. **Details last,** or in a thread, or behind a link.

## Rules

- **One topic per message.** A second topic gets a second message.
- **At most 5 items in a list,** the most important first. Put the rest in a thread or a doc.
- **Number the steps** when order matters. Use bullets when it does not.
- **Say where things stand:** "2 of 3 done. Left: the migration."
- **Give real times:** "about 2 hours" or "by Friday 5 pm", not "soon" or "a bit of work".
- **Name the person you need,** with a mention only when they must act.
- **Use links with names:** "PR #128", not a bare URL.
- **No empty openers or closers.** Skip "Hope you're well", "Just checking in", "Let me know if you
  need anything" and "Thanks in advance".
- **No idioms or sidebars.** Write "start", not "get the ball rolling". Skip "by the way".
- **Write as the person.** No "Generated with …" lines, no credit to an AI tool, no robot emoji,
  nothing that says an AI wrote it. The message goes out in the person's name.
- **Errors and bad news are plain:** what happened, the effect, and the fix or the next step.
  No "Oops" or "Uh oh".
- **Bold only the one thing** the reader must not miss.

## Per channel

- **Slack:** keep it short and put details in the thread. Slack's bold is `*bold*` and its links are
  `<url|text>`.
- **Email:** the subject says the ask or the news ("Decision needed: plan for the v2 launch"). The
  first sentence repeats it.
- **PR and ticket comments:** the file and line, what is wrong, and the fix. One comment per point.
- **Announcements:** what changes, for whom, from when, and what readers must do. Then the link.

## Before you send

1. Read only the first line. Does the reader know what you need?
2. Delete the first sentence if it only leads into the message.
3. Delete the last sentence if it only offers more help.
4. Check every name, date, number and link.

Show the person the draft. Send it or post it only when they say yes.
`airband writing check --message <file>` checks a saved draft for long lists and empty phrases.
