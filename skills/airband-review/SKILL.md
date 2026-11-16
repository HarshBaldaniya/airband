---
name: airband-review
description: Review a pull request, a branch, or your own changes before a PR, with Airband's map. It finds what changed, who calls it, which tests reach it, and what the diff leaves behind. Use when the person asks to review a PR (a number or a link), to review their changes, or to check a branch before a PR.
---

# Review a pull request

If this project or the person has its own review skill or checklist, follow that one. Use Airband's
tools inside it for steps 2 to 4.

## 1. Pick the mode

| What you were given | Mode | The review ends with |
|---|---|---|
| Nothing, "my changes", or a branch name | **Self**: before a PR | Ready for PR, or Fix first. Offer to fix. |
| A PR number or link by the person | **Own PR** | Fix and push. You cannot approve your own PR. |
| A PR number or link by someone else | **Their PR** | One review, posted only after the person says yes. |

To find who wrote a PR, use the GitHub CLI or a GitHub tool if one is connected.

## 2. What changed

- `airband_map` with `diff`. Use `"#128"` for a PR (Airband fetches it without a checkout), a branch
  name, or `"main..feature"`. Give nothing to compare this branch with the default branch.
- The answer lists every function, class and type that was added, changed, moved or removed. Each
  one has `path:start-end`, its callers and the tests that reach it.
- "Left with no caller" lists code that only removed code used. It is dead now.
- For their PR, also read the PR's title, body and checks if a GitHub tool is connected.
- Read the changed ranges. To read a file at the PR's head without a checkout, run
  `git show <head>:<path>`.

## 3. What happened before

- `airband_flightlog` with `query` set to the PR number, the branch, or the ticket id in the title
  (`ENG-142`). This finds earlier chats on the same work: what was tried and what was left open.
- `airband_notes` for notes on this area.

## 4. The sweep: what the diff leaves behind

A diff shows only the lines that changed. Check these too:

1. **Removed or renamed names.** For each one, the diff answer lists who still calls it. Also look
   for the name in tests, stories, fixtures, mocks and docs: `airband_map` with `find`, then grep
   for the exact name. Any use that remains is a finding.
2. **Orphans.** Use "Left with no caller" from the diff, and `airband_map` with `check: "unused"`
   on a checked-out branch. Remove dead code, or say why it stays.
3. **Shared code that changed.** A changed function with many callers changes behaviour for all of
   them. Read the callers the diff lists. Name what each caller now gets.
4. **Other projects.** A changed API route, type or event can break another project.
   Use `airband_map` with `in: "<project>"` and `find: "<route or name>"`.
5. **Comments and docs.** Read the comments near each changed line. A comment that now says
   something false is a finding. `airband_map` with `check: "docs"` finds docs that name files or
   scripts that no longer exist.
6. **Edges.** For each new limit or clamp, try 0, a negative number, the maximum and empty input.
7. **Tests.** A changed function that no test reaches gets a test or a reason. Look at tests that
   changed without code changes, and at code that changed without its tests.

## 5. What to look for

- **Correctness:** wrong results, missed cases, races, retries that run twice, error paths.
- **Security:** who can call it, input checks, secrets, data from one user or tenant shown to
  another.
- **Contracts:** API shapes, backwards compatibility, the order to deploy services in.
- **Scope:** files that belong in another PR (lockfiles, generated files, unrelated edits).
- **The PR body:** does it match the code? Skip this in Self mode.

Every finding needs `path:line` and a real way it fails: "When X, Y happens". No failure, no finding.

## 6. Severity

| Tag | Meaning | Effect on the verdict |
|---|---|---|
| **Blocker** | Breaks production, opens a security hole, or loses data | Changes requested (Self: Fix first) |
| **Must fix** | A user gets wrong behaviour | Changes requested (Self: Fix first) |
| **Before merge** | A step the author can do alone: merge order, regenerate a file, a manual check | Approve, with this list |
| **Nit** | Optional | No effect |

Only a bug in the code blocks. A worry with no failure you can show ("this might be slow") is
Before merge.

## 7. Report

1. The verdict on the first line, with the counts: "Changes requested: 1 must fix, 2 nits."
2. Findings, the most serious first. Each one: tag, `path:line`, what goes wrong and when, the fix.
3. Before merge steps, if there are any.
4. What the tests miss.
5. If nothing is wrong, say so plainly.

Show the review in the chat first. Post it to GitHub only when the person says yes, as one review
with comments on the lines.
