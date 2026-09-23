# Single source of truth

Applies when introducing a constant, flag, option, or any fact the code
states in more than one place.

1. **Define once, derive everything else.** Any fact stated in two places
   will eventually disagree. Keep one canonical definition; compute all
   other forms (spellings, tokens, lists, lookups) from it, so a change
   touches exactly one literal.
2. **One code path per concept.** Two loops that both map aliases to flag
   tokens are a future inconsistency. Extract the shared function even if
   each call site is only a few lines.

Example: a `--human` switch is declared once as a parser args definition;
the `--human` token, the parser lookup, the usage-string rendering, and the
validation set all derive from it through one shared token-mapping helper.
