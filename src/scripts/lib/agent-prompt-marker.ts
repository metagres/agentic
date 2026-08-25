/**
 * Agent system-prompt purity markers (TASK-007).
 *
 * Agent definitions carry neutral personality prose only: they must never
 * reference the toolkit's CLI, its skill machinery, or the envelope contract,
 * otherwise instruction drift could leak machinery into agent behavior. This
 * module owns the marker vocabulary and the deterministic, case-insensitive
 * detection used by bin/validate-policies.ts, kept separate so the policy is
 * unit-testable. Pure and deterministic: identical inputs always produce
 * identical outputs.
 */

/** CLI flags, script paths, and envelope directive phrases that must never
 *  appear in an agent system prompt. The bare words "data" and "accept" are
 *  deliberately absent — only the full phrase "the data field" and the flag
 *  "--accept" are markers, so natural personality prose never trips the check.
 */
export const PROMPT_MARKERS: readonly string[] = [
  'sdlc',
  '--change',
  '--request',
  '--update-artifact',
  '--append-delta',
  '--complete-step',
  '--finalize',
  '--confirm-semantic',
  '--record-answer',
  '--set-clarity',
  '--next-ids',
  '--accept',
  '--reject',
  '--task-id',
  'scripts/sdlc.js',
  'the instructions field',
  'the data field',
  'the envelope',
];

/**
 * findPromptMarkers(prompt): returns every marker from PROMPT_MARKERS that
 * occurs in the prompt, matched case-insensitively, in marker-list order, and
 * without duplicates. A prompt free of markers (clean personality prose)
 * yields [].
 */
export function findPromptMarkers(prompt: string): string[] {
  const haystack = prompt.toLowerCase();
  const found: string[] = [];
  for (const marker of PROMPT_MARKERS) {
    if (haystack.includes(marker.toLowerCase())) {
      found.push(marker);
    }
  }
  return found;
}
