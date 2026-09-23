# Agent Instructions

Following the documents referenced below is mandatory. Do not proceed on
assumptions where a referenced document governs.

- Determine the task kind first: toolkit development or toolkit use.
  Canonical source and deployed output are separate; never confuse them.
- Read `docs/rules/` and follow every applicable rule set. When to use which:
  | Situation | Rule set |
  |---|---|
  | Adding, removing, or changing any exported symbol; creating a module or barrel file; touching imports | [module-surface](docs/rules/module-surface.md) |
  | Introducing a constant, flag, option, or any fact the code states in more than one place | [single-source-of-truth](docs/rules/single-source-of-truth.md) |
  | Structuring programs, entry points, registries, or adopting a third-party library | [architecture](docs/rules/architecture.md) |
  | Changing observable behavior: output formats, exit codes, error shapes, CLI grammar, or migrating an implementation | [contracts](docs/rules/contracts.md) |
  | Adding, upgrading, or removing a dependency | [dependencies](docs/rules/dependencies.md) |
  | Finishing any change: checks to run, tests to keep green, docs and comments to update | [verification](docs/rules/verification.md) |
  When several apply, apply all of them. Where this index and a rule set
  disagrees, the rule set governs. Full index at `docs/rules/README.md`.
- Follow the normative contract in `docs/current/` before making changes.
- Check `docs/decisions/` for recorded decisions constraining the task;
  record new cross-cutting decisions there.
- Follow the applicable plan in `docs/plans/`. Treat `docs/work-items/`
  as project-owned lifecycle data.
- Preserve the specification's validation, atomic-write, and human-only
  approval boundaries.
- Propose and record the choice before adding a dependency; see
  `docs/rules/dependencies.md`.
