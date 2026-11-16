---
name: airband-spend
description: Show the tokens AI chats spent, by project, agent, ticket and chat, and where one chat's tokens went, with ways to spend less. Use when the person asks how many tokens or how much AI cost, which project or ticket costs most, or for a spend report for finance.
---

# AI spend

1. **The totals.** In a terminal, run `airband spend`. If `airband` is not found, run
   `node "$HOME/.airband/airband.js" spend`. The default is the last 7 days. Add `--days 30`, or
   `--in <project>`, or `--json` for a sheet. You get the tokens by project, by agent, by ticket or
   PR, and the biggest chats.
2. **One chat in detail.** Call `airband_flightlog` with `chat: "<id>"` and `tokens: true`. It shows
   where that chat's tokens went. You get finding code compared with doing work, the biggest
   reads, the files read again and again, and tips.
3. **Report.**
   - The total, and the split between new input, output and cache reads. Cache reads cost about a
     tenth of new input, so a large cache-read figure is not a large bill.
   - The top 3 projects or tickets, with their share.
   - The 2 or 3 biggest chats, and why they were big.
   - 2 or 3 ways to spend less, from step 2. For example: use the map before you read whole files.
     Start a new chat for a new task. Save a note instead of pasting the history again.

Rules:

- Tokens per ticket are an estimate. A chat's tokens are split over its asks. Say so.
- Only chats with an Airband flightlog are counted.
- Give money amounts only if the person gives you the prices. On a subscription plan, tokens show
  how much of the plan is used, not a bill.
