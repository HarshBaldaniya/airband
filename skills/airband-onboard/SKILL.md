---
name: airband-onboard
description: Explain a codebase to someone new in a few minutes, with Airband's map, notes and past chats. It covers what the project does, its main parts, where to start reading, and how to run it. Use when the person is new to a project, asks to explain a repo, or asks where to start or how it is laid out.
---

# Show someone around a codebase

1. **The shape.** `airband_map` with no arguments gives the commands, entry points, main parts and
   conventions.
2. **The main parts.** For the 3 to 5 biggest or most central folders, call `airband_map` with
   `outline: "<folder>"`. For the one or two central names, call `graph`: what uses them and what
   they use.
3. **What people already know.** `airband_notes` gives the notes earlier chats left here.
   `airband_flightlog` with `query` set to the project's main words shows recent work in this
   folder.
4. **How to run it.** Read the README, and the scripts in the package file or Makefile. Name the
   commands to install, run, test and lint.
5. **Write the tour.** Keep it under one screen:
   - What it is: one sentence.
   - The main parts: one line each, with the folder and the key file as `path`.
   - How a request or action flows through the code: 3 to 6 steps, with `path:start-end` for each.
   - How to run, test and lint it: the commands.
   - Where to start for the person's task, if they named one.
   - What is surprising: rules and gotchas from the notes.
6. If the person wants it kept, save the tour with `airband_notes` (title "Project tour").

Use plain words. Explain each term the first time you use it. Show code only when it saves words.
