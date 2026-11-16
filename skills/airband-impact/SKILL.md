---
name: airband-impact
description: Find everything a change would touch before making it, with Airband's map: callers, importers two steps out, tests, and other projects that use it. Use when the person asks what breaks if something changes, what uses a function or file, whether something is safe to rename, move or delete, or how big a change is.
---

# What a change would touch

1. `airband_map` with `graph: "<name or path>"` and `hops: 2`: who uses it, and who uses them.
   A file shows its importers; a name shows its callers with `path`.
2. **Tests.** Callers in test files are the tests that reach it. None means the change is
   unguarded: say so.
3. **Other projects.** If it is an API, a type or a package other code depends on, ask the projects
   the person mapped: `airband_map` with `in: "<project>"` and `find: "<name or route>"`.
4. **Already in flight.** `airband_map` with `diff` (this branch) shows if it is already changed here;
   `airband_flightlog` with `query: "<name>"` shows other chats that touched it.
5. **Answer** with the count and the list (`path` per caller), what is risky (dynamic use the map
   can't see, public exports, routes), and the order to change things in.
