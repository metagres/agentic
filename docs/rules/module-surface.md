# Module surface

Applies when adding, removing, or changing any exported symbol; creating a
module or barrel file; touching imports.

1. **Export only what external modules consume.** If nothing outside the
   module imports a symbol, make it private. If nothing uses it at all,
   delete it. Public surface is a liability, not documentation.
2. **Never import solely to re-export.** No barrel files that hide real
   dependencies. Every import must serve the importing module's own code;
   type imports used in local signatures are consumption, not barreling.
3. **Delete dead code in the same change that kills it.** A helper that loses
   its last external caller goes private immediately; a type with zero
   consumers is removed. "Might need later" is what version control is for.

Example: an entry point stops calling `formatEnvelope()` directly and uses a
higher-level `writeStderrEnvelope()` instead — `formatEnvelope` becomes
private in that same edit, and an unused `ExitCode` alias is deleted rather
than kept for a hypothetical consumer.
