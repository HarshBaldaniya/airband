---
name: airband-test-plan
description: Write a test plan for a pull request, branch or feature with Airband's map. It covers what changed, which changes no test reaches, the cases to test, and the manual checks. Use when the person asks what to test, for a test plan or QA of a PR or feature, or whether a change is covered.
---

# Write a test plan

1. **What changed.** `airband_map` with `diff` (`"#128"`, a branch, or nothing for this branch).
   Note each changed function, its callers and the tests that reach it.
2. **The gaps.** List the changed or added code that no test reaches. Put first the code that
   many callers use, or that handles money, permissions or data.
3. **What it was for.** `airband_flightlog` with `query` set to the ticket or PR id gives the intent
   and the edge cases earlier chats discussed. If a ticket tool is connected, read the ticket's
   acceptance criteria.
4. **The cases.** For each changed unit, write:
   - the normal case;
   - the edges: empty, zero, negative, the maximum, one item, many items;
   - the errors: bad input, a failing dependency, no permission;
   - for each caller the diff lists, one case for each new behaviour it gets.
5. **Manual checks** for what tests cannot see: the UI at phone and desktop widths, both themes,
   slow network, the first run with no data.

## The plan

| # | What to test | Steps | Expected | Unit, integration or manual | Risk |
|---|---|---|---|---|---|

Put the highest risk first. Under the table, list the existing tests to run (the files the diff
named) and the command to run them. If the person asks, write the missing tests.
