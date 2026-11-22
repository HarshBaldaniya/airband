[← Airband](../README.md)

# What your agents get

This page lists the tools and skills Airband gives your agents, and shows the jobs they are most used for: reviewing a pull request, following a ticket, and reporting what your chats did.

## Tools and skills

Setup gives each agent three tools over MCP (under 400 tokens of definitions in all), the
instructions to use them, and 15 skills they pick up by themselves when a task matches.

| Tool | What an agent does with it |
|---|---|
| `airband_map` | `find` code by name or meaning, ranked, with `path:start-end`; `outline` a file or folder; `graph` who uses what; `check` unused code and stale docs; `diff` what a branch or pull request changed; `in` another project you mapped; or an overview of the project |
| `airband_flightlog` | Read another chat's asks and outcomes, or search every chat, by words, code names, tickets (`ENG-142`), PRs (`#128`) or Figma links |
| `airband_notes` | Read and leave notes for the next chat in this project |

Each skill does a job with what only Airband knows: the map of your code, the records of every
chat, and the notes chats leave. You don't call them. Ask for the job in your own words, and the
agent picks the skill. Only a skill's one-line description sits in each chat. The rest loads when
the skill is used.

| For | Skill | Used when you ask to … |
|---|---|---|
| Developers | `airband-find-code` | find where something is, or what uses it |
| | `airband-impact` | know what a change would break, or whether a rename or delete is safe |
| | `airband-review` | review a PR, a branch, or your own changes before a PR |
| | `airband-debug` | find why something is broken (it first checks whether an earlier chat saw it) |
| | `airband-onboard` | explain a codebase to someone new |
| QA | `airband-test-plan` | plan the tests for a PR or feature, starting with the changes no test reaches |
| Product and leads | `airband-progress` | say where a ticket, feature or PR stands |
| | `airband-ticket` | pick up a ticket, issue, PR or Figma link with what was done on it before |
| | `airband-standup` | write a standup or a weekly update from your chats |
| Finance and founders | `airband-spend` | show the tokens spent by project, agent, ticket and chat |
| Everyone | `airband-recall` | find what was done before, and which chat did it |
| | `airband-catchup` | hear what the other chats did while you were away |
| | `airband-handoff` | leave the work so another chat or agent can continue it |
| | `airband-write-docs` | write a PRD, spec, README or PR description no one can misread |
| | `airband-write-messages` | write a Slack post, email or comment people can act on |

If you have your own skill for the same job (your team's review checklist, say), the agent follows
yours and uses Airband's tools inside it.

The commands are there to run by hand too: `/airband:review` in Claude Code, `/prompts:review` in
Codex, `/review` in Gemini CLI.

## Reviewing a pull request

`airband_map` with `diff: "#128"` reads the pull request from git without checking it out. In a
terminal, run `airband diff #128`. It lists every function, class and type the PR added, changed,
moved or removed. Each one has `path:start-end`, its callers and the tests that reach it. Removed
code that something still calls is flagged. A number is fetched from `origin` first. A branch name or `main..feature`
works too. With nothing given, it compares this branch with the default one. Code that only the
removed code used is listed as "Left with no caller".

```text
main...#128 (4f1c2a9e0 → 9b77d03c1): 6 declarations changed in 3 files.
src/billing/seats.ts
  removed oldSeatCount function was :12-30 · still used by 1: invoiceLines src/billing/invoice.ts (check these)
  changed syncSeats function :40-88 · used by 4: onMemberJoined src/team/members.ts, … · tests: test/seats.test.ts
src/team/members.ts
  changed onMemberLeft function :61-79 · used by 2: removeMember src/team/api.ts, … · no test reaches it
```

With `in: "my-api"` (or `--in my-api`), the same questions go to another project you have mapped.
Name it by its folder. A chat in your app can then look up the API route it calls.

## Tickets, issues and designs

Each chat's record keeps the tickets and links named in it. These are Linear and Jira ids
(`ENG-142`), GitHub pull requests and issues (`#128`, links), and Figma files and frames. Ask any agent "what did we do
for ENG-142?" and it finds the chats, in any agent, that worked on it. Airband does not connect to
Linear, GitHub or Figma. It remembers what your chats did with them.

## Standups and AI spend

Airband already keeps a record of every chat in every agent, so it can answer two questions no
single agent can:

```bash
airband standup              # what your chats did yesterday and today, per project
airband standup --days 7     # the week, for a weekly update
airband spend                # tokens in the last 7 days: by project, agent, ticket and chat
airband spend --days 30 --json
```

```text
Since Tue 10 Nov: 3.4B tokens in 17 chats (46k new input, 7.7M output, 3.4B cache reads).

By project
  my-app                      1.8B   54%  8 chats
  my-api                      1.6B   46%  6 chats
```

Ask an agent for "my standup" or "AI spend this month" and it uses these, then writes the update for
you. Tokens are what each agent reported in its own files. Tokens per ticket are an estimate, because
agents report tokens per reply, not per topic.
