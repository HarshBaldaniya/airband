---
name: airband-handoff
description: Leave this chat's work so another chat (Claude Code, Codex or Gemini CLI) can pick it up without asking: what was done, what is open, the files, the branch and the decisions. Use when the person says hand off, wrap up, save where we are, or that another chat or agent will continue this.
---

# Hand the work over

1. **Gather.** Collect these:
   - what this chat set out to do, what is finished, and what is still open;
   - the files changed, the branch and commits, and the tickets and PRs (`ENG-142`, `#128`);
   - the decisions made and why, and anything tried that did not work.
   `airband_map` with `diff` lists what the branch changed.
2. **Save one note.** `airband_notes` with `title` (the task in a few words) and `text`:
   - Done: one line each.
   - Open: the next step first, with `path:line`.
   - Decisions: what was chosen and why, and what was ruled out.
   - How to check: the command or test that shows it works.
   Short lines, no story. Paths, names and ids exactly as they are.
3. **Tell the person** the note's name, and that any chat can read it with `airband_notes`, or
   hear this chat's work by saying "catch up".
