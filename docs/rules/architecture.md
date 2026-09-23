# Architecture

Applies when structuring programs, entry points, registries, or adopting a
third-party library.

1. **Entry points orchestrate; they never implement.** Routing, I/O, and
   exit handling at the top; domain logic in modules. If adding a feature
   requires editing the entry, the seam is wrong.
2. **Registration, not modification.** New behavior plugs in through a
   registry or factory owned by its own module. The dispatcher stays
   closed; the entry is untouched when capabilities land.
3. **Libraries advise; the application decides.** Third-party code parses,
   validates, or renders — it never owns process exit, global state, or
   user-facing contracts. Wrap the seam so the library stays replaceable;
   never adopt the framework's main runner when it owns failure behavior
   you must control.
4. **Strictness the framework cannot express stays explicit.** Do not rely
   on a lenient parser to enforce a contract. Write the guard yourself,
   name it, co-locate it with the contract, and test it directly.

Example: a CLI entry dispatches through an ordered command registry and
rejects unknown flags with its own guard because the parsing library is
non-strict by design; per-command typed options plug in as declarations
without touching the entry.
