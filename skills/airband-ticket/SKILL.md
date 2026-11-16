---
name: airband-ticket
description: Pick up a ticket, issue or design (a Linear or Jira id like ENG-142, a GitHub issue or PR like #128, or a Figma link) with everything already done on it in earlier chats and the code it points to. Use when the person names a ticket, issue, PR number or Figma link to work on, or asks what was done for one.
---

# Work on a ticket

1. **What was done before.** `airband_flightlog` with `query: "<the id>"` (`ENG-142`, `#128`, or a
   Figma file's name). Chats keep these ids from the person's words and the replies, so earlier
   work turns up whichever agent did it. Read the best matches: `chat` and `n`.
2. **The ticket itself.** If a Linear, GitHub or Figma tool is connected, read the ticket, issue or
   frame there. Airband does not read those services; it remembers what chats did with them.
3. **The code.** `airband_map` with `find` on the ticket's main words and names, then `outline` or
   `graph` on what it finds. If a branch or PR for it exists, `airband_map` with `diff` shows what
   it already changed.
4. **Answer** with what is already done (which chat, when, which PR), what is left, and where in
   the code to start, with `path:start-end`. Then do the work if asked.
