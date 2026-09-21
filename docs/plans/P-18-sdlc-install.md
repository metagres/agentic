# P-18 — `sdlc install`

P-18

### Goal
Install the generated deployment payload into a target repository or global OpenCode location.

### Deliverables
- Command:

```bash
sdlc install --target <repo> --scope project|global [--force]
```

- Bootstrap form:

```bash
node dist/tools/sdlc/bin/sdlc-cli.js install ...
```

- Verify:
  - Node availability;
  - supported OpenCode version range, using mechanism confirmed in P-00.
- Copy deployment payload into target `.opencode/` tree.
- Refuse overwrite without `--force`.
- Record installation scope and version in `.opencode/tools/sdlc/manifest.json`.

### Testable acceptance criteria
- Fresh repository installation succeeds with one invocation.
- Existing installation without `--force` exits 5.
- `--force` replaces installed payload.
- Manifest records version and scope.
- Unsupported Node or OpenCode version exits 3.

### Dependencies
- P-00.
- P-01.
- P-16 and P-17 for deployable content.
