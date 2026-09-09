// Shared forbidden-word profile used by the forbidden-words check. Ported
// verbatim from the legacy lint-checks.ts so the check reproduces current lint
// behavior exactly. Only the hard forbidden list produces findings — every
// finding blocks by definition.

export const FORBIDDEN_WORDS = [
  'fast',
  'user-friendly',
  'gracefully',
  'appropriately',
  'it works',
  'it handles',
  'easy',
  'simple',
  'robust',
  'seamless',
  'intuitive',
  'optimal',
  'as needed',
];
