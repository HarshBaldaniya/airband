---
name: airband-progress
description: Say where a ticket, feature or PR stands, from every chat that worked on it and the code. It covers what is done, what is open, what blocks it, and the next step. Use when the person asks where a ticket or feature stands, what is left on a PR, or for a status update for a manager.
---

# Where a piece of work stands

1. **Every chat on it.** `airband_flightlog` with `query` set to the ticket id, the PR number, or
   the feature's name. Read the best matches with `chat`. Note the dates, what each chat did, and
   what it left open.
2. **The code.** If a branch or PR exists, `airband_map` with `diff` shows what it changed and what
   has no test yet.
3. **The ticket and the PR.** If a ticket tool or GitHub is connected, read the ticket's status,
   the PR's checks and its reviews.
4. **Write the status.** Use the message rules (the airband-write-messages skill):
   - First line: the state in a few words. For example: "Built, in review, 1 fix left."
   - Done: one line each, with the PR or commit.
   - Left: one line each, with an owner if known.
   - Blocked by: who or what, since when.
   - Next step, and an honest time estimate.

Say where each fact comes from: a chat (with its date), the code, or the ticket. Do not guess a
status that nothing shows.
