# Contracts

Applies when changing observable behavior — output formats, exit codes,
error shapes, CLI grammar — or migrating an implementation.

1. **Machine contracts outrank convenience.** Output formats, exit codes,
   and error shapes are API. Changing them is a versioned, recorded
   decision, never a side effect of refactoring.
2. **Migrations preserve observable behavior exactly, including edge
   cases.** If the old code rejected an input, the new code rejects it
   identically unless the change is explicitly specified, reviewed, and
   tested. "Unspecified" means "don't touch," not "free to change."
3. **Keep contract tests frozen during refactors.** If the same tests pass
   before and after without modification, the migration preserved
   behavior. Rewriting tests and code simultaneously proves nothing:
   adapt structure tests to the new seam, leave contract tests untouched.

Example: swapping a hand-rolled argument parser for a library keeps every
exit-code and output-shape test green as-is; only the structural tests that
assert the parsing seam are rewritten.
