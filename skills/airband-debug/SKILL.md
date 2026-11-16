---
name: airband-debug
description: Find the cause of a bug or error with Airband. It checks whether an earlier chat saw the same error or tried a fix, traces the code path with the map, then tests one idea at a time. Use when something is broken, for an error or a stack trace, a failing test, or a question about why something happens.
---

# Find the cause of a bug

1. **Was this seen before?** `airband_flightlog` with `query` set to the error's key words, the
   failing test or the function's name. Earlier chats in any agent may have the cause, or a fix
   that did not work. Read the best match whole: `chat` and `n`. Also check `airband_notes`.
2. **Where it happens.** Take the file and line from the stack trace or error. `airband_map` with
   `find` on the function or message, then `graph` to see who calls it and what it calls. Read
   only those ranges.
3. **Did it change lately?** `airband_map` with `diff` on this branch shows what changed. Also run
   `git log -L <start>,<end>:<path>` on the lines involved.
4. **Reproduce it.** Find the smallest command, test or input that shows the bug. Write it down.
5. **One idea at a time.** Say the idea, and the check that proves it or rules it out. Then run the
   check. Change one thing per try.
6. **Three tries failed?** Stop changing code. Name the assumption that may be wrong (the data,
   the version, the environment, the cache). Ask the person one question about it.
7. **When it is fixed,** add or name the test that would have caught it. Save a note with
   `airband_notes`: the symptom, the cause, the fix and the file. The next chat that sees this
   finds it at step 1.

Report the cause first, with `path:line`. Then the fix and how you checked it.
