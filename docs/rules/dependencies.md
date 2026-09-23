# Dependencies

Applies when adding, upgrading, or removing a dependency.

1. **Justify before adding.** Every new dependency needs a recorded
   why-this-one — alternatives considered, maintenance health, weight,
   and fit — before installation, proportional to its blast radius.
   Propose the choice; never sneak it in with an unrelated change.
2. **Pin volatile versions exact.** A `0.x` library can break on a minor
   bump. Exact pins plus lockfiles make every upgrade deliberate.
3. **Contain the blast radius.** New capabilities arrive behind an existing
   abstraction (adapter, seam, registry), so swapping or removing the
   dependency later is local churn, not architectural. Prefer zero-dependency
   options where they satisfy the requirement, and keep deployment
   constraints (e.g. bundled, runtime-only) intact.

Example: adopting a zero-dependency CLI parser at an exact `0.2.2` pin,
behind a command-registry seam, inlined at build time so the deployed
artifact keeps a runtime-only dependency footprint.
