// Shared forbidden-word profiles used by the forbidden-words check. Ported
// verbatim from the legacy lint-checks.ts so the check reproduces current lint
// behavior exactly.

export const BLOCKING_WORDS = [
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

export const ADVISORY_WORDS = [
  'should',
  'reasonable',
  'sufficient',
  'normal',
  'expected',
  'proper',
  'maybe',
  'probably',
];
