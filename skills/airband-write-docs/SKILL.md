---
name: airband-write-docs
description: Write or rewrite docs that no reader can misread, such as PRDs, specs, READMEs, guides, PR descriptions, changelogs, error messages, UI text and tool descriptions. It uses short sentences, one meaning per word and active voice. Use when writing or editing any doc, or for "make this clearer", "simplify this", or "plain English".
---

# Write docs no one can misread

These rules come from controlled-language writing: the plain English that manuals use so that
readers, translators and AI agents read each sentence one way only. If the project or the person
has their own writing rules, those come first.

## Two strengths

- **Strict** is for steps, error messages, UI text, tool descriptions, and instructions for another
  agent. Apply every rule.
- **Plain** is for PRDs, specs, READMEs, guides, PR descriptions and changelogs. Apply the sentence
  rules. Some variety in words is fine.

## Sentences

| Do | Don't |
|---|---|
| One idea per sentence. At most 20 words for an instruction, 25 for a description. | Join ideas with "and", "which" or "while" into one long sentence. |
| Active voice: "The server rejects the request." | Hide who acts: "The request is rejected." |
| Simple tenses: "The job failed." | "The job has been failing." Keep a compound tense only when it carries meaning ("has finished" = finished and ready now). |
| One instruction per step, as a numbered list. | "Open the file and change line 3, then run the tests." |
| Keep the small words: "the files that are not saved" | Drop them: "unsaved files lost" |
| Split the sentence in two. | Use a semicolon. |
| At most 3 nouns in a row: "the cache file path" | "the user session cache file path setting" |

## Words

- **One name for one thing.** Do not switch between "user", "customer" and "account" for the same
  thing. Choose one name and use it every time.
- **Plain verbs.** "Start", not "kick off" or "spin up". "Contact", not "reach out to". "Check",
  not "perform a check of". "Decide", not "make a decision".
- **No hype.** Delete "seamless", "robust", "powerful" and "blazing fast". Give the fact instead:
  "loads in 200 ms".
- **No filler.** Delete "please note that" and "it is important to note". Write "to", not "in order
  to". Write "because", not "due to the fact that".
- **Define a term once,** the first time you use it, if a reader may not know it.
- **Write as the person, for people.** Do not add "Generated with …" or "Co-Authored-By" lines that
  name an AI tool, robot emoji, or "As an AI". The doc is the author's, and readers judge it on what
  it says.

## Meaning comes first

- Keep every fact, number, condition and limit.
- Keep every hedge. "May have failed" stays "may have failed". Do not turn a guess into a fact.
- Add no claim, cause or number that the source does not give.
- If a shorter sentence would lose something, keep the longer one.
- Shorter is not the goal. A sentence is done when it has one meaning, not when it has the fewest
  words.

## Layout

- One topic per paragraph, at most 6 sentences.
- Three or more steps or conditions go in a list.
- Headings say what the section answers: "How to deploy", not "Deployment considerations".
- Code, commands, paths and names go in code formatting, exactly as they are.

## Check it

- After you write a doc file, Airband checks the new text and names what breaks these rules.
- `airband writing check <file>` checks a file by hand, and in CI. It finds long sentences,
  semicolons, hype words, two-word verbs and filler.
- It cannot judge meaning. Read the result once as the reader would.

When you rewrite someone's text, give back the new text alone. Explain the changes only when asked.
