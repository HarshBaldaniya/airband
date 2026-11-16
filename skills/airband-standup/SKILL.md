---
name: airband-standup
description: Write a standup or a weekly update from what the person's AI chats did, across every project and agent. Use when the person asks for a standup, a weekly update, or what they did yesterday or this week.
---

# Write a standup

1. **Read the work.** In a terminal, run `airband standup`. If `airband` is not found, run
   `node "$HOME/.airband/airband.js" standup`. The default is yesterday and today. Add `--days 7`
   for a week, or `--in <project>` for one project. You get each project's chats with their asks,
   their outcomes, the tickets and PRs, and what is still open.
2. **Fill gaps** only if needed. `airband_flightlog` with `chat` and `n` gives one ask's full words.
   If GitHub or a ticket tool is connected, it shows a PR's state.
3. **Write it** with the message rules (the airband-write-messages skill):

```
Yesterday
- <outcome, not activity>: <ticket or PR>
Today
- <the next step from what is open>
Blockers
- <who or what, or "None">
```

- Write outcomes ("Seat sync now rejects negative counts, PR #128"), not activity ("worked on
  seats").
- Join the asks that were about one thing into one line.
- At most 5 lines per part.
- Leave out chats about tools, setup or personal things unless the person asks for them.

Show the draft. Post it only when the person says yes.
