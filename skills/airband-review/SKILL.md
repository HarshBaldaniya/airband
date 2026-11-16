---
name: airband-review
description: Review a pull request or branch with Airband's map: what it changed, who calls each change, which tests reach it, and what earlier chats did on it. Use when the person asks to review a PR (a number, a link or a branch), to check their changes before opening one, or to re-check a PR after fixes.
---

# Review a pull request

1. **What changed.** `airband_map` with `diff`: `"#128"` for a pull request (fetched from origin,
   nothing is checked out), a branch name, or `"main..feature"`. Nothing given means this branch
   against the default one. It lists every function, class and type added, changed or removed,
   with `path:start-end`, who calls it and which tests reach it.
2. **Earlier work on it.** `airband_flightlog` with `query: "#128"` (or the ticket id in the PR
   title, like `ENG-142`): chats that already worked on it, and what they left open.
3. **Read only what matters.** Open the changed ranges the diff gave, and the callers of anything
   changed or removed. `git show <head>:<path>` reads a file at the PR's head without switching.
   A change that crosses into another project: `airband_map` with `in: "<project>"` and `find`.
4. **Look hardest at:** removed or renamed code that something still calls; changed functions no
   test reaches; tests changed without the code (or the other way round).
5. **Report** findings first, most serious first, each with `path:line`, what goes wrong and when.
   Then what is missing from tests. Say plainly when nothing is wrong.
