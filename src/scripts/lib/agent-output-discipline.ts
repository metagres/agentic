/**
 * Agent output-discipline fragment (CMP-001, DM-001).
 *
 * Every rendered agent carries one shared output-discipline fragment after its
 * role prompt: reply rules that keep chat replies terse and reasoning rules
 * that shift reasoning habits. This module owns the fragment as the single
 * source of truth (FR-002) — an exported constant beside the compose and
 * detection helpers, patterned on agent-prompt-marker.ts — so the registry,
 * renderers, deploy smoke, and startup validation all import the same text
 * and no YAML include mechanism is needed (DEC-002).
 *
 * The fragment is rules only: no worked examples, no role content, no
 * repetition of stage instructions, at most twelve lines (NFR-001), no token
 * cap, and no telegraphic rules (AC-008). The reasoning rules are phrased as
 * guidance with no enforcement claim and no numeric cap (AC-010). Pure and
 * deterministic: identical inputs always produce identical outputs.
 */

/** The canonical fragment text, carried verbatim from design DM-001: one
 *  header clause with the plain-English/no-token-cap rule, five reply-rule
 *  bullets, and one reasoning line carrying the three reasoning rules. */
export const OUTPUT_DISCIPLINE_FRAGMENT: string = [
  'Output discipline for every reply and every reasoning step - plain English sentences, no token cap:',
  '- No preamble, acknowledgments, or self-introduction; start with the substance.',
  "- Never restate the user's request or the step instructions you were given.",
  '- Never recap CLI envelope or tool output the user can already see.',
  '- A finished step is reported in one line: what is done and the artifact path.',
  '- When blocked, state what is blocked, why, and what unblocks it.',
  'When reasoning: do not restate the request or instructions; no audience-addressed filler; reason in fragments of facts, options, and decisions.',
].join('\n');

/** Stable marker phrase (CMP-004): the deploy smoke fails when a rendered
 *  agent body lacks it, so rewording the fragment must update this constant
 *  deliberately (the DELEGATION_RULE_MARKER precedent). */
export const OUTPUT_DISCIPLINE_MARKER = 'No preamble, acknowledgments, or self-introduction';

/**
 * Distinctive marker phrases derived from the fragment's own lines (DEC-003).
 * Exported beside the text so they cannot drift from it: rewording the
 * fragment updates its markers deliberately. Consumed by the validate-policies
 * unauthorized-copy check (AGENT_FRAGMENT_COPY) and by unit tests.
 */
export const FRAGMENT_MARKERS: readonly string[] = [
  'Output discipline for every reply and every reasoning step',
  'No preamble, acknowledgments, or self-introduction',
  "Never restate the user's request",
  'Never recap CLI envelope',
  'what is done and the artifact path',
  'what is blocked, why, and what unblocks',
  'no audience-addressed filler',
  'reason in fragments of facts, options, and decisions',
];

/**
 * composeEffectivePrompt(systemPrompt): the composed deploy-time prompt
 * (DM-002) — the role prompt verbatim, one blank line, then the fragment.
 * Pure: returns a new string and never mutates its input.
 */
export function composeEffectivePrompt(systemPrompt: string): string {
  return `${systemPrompt}\n\n${OUTPUT_DISCIPLINE_FRAGMENT}`;
}

/**
 * findFragmentMarkers(prompt): returns every marker from FRAGMENT_MARKERS that
 * occurs in the prompt, matched case-insensitively, in marker-list order, and
 * without duplicates. A prompt free of fragment text yields [] (the
 * findPromptMarkers pattern).
 */
export function findFragmentMarkers(prompt: string): string[] {
  const haystack = prompt.toLowerCase();
  const found: string[] = [];
  for (const marker of FRAGMENT_MARKERS) {
    if (haystack.includes(marker.toLowerCase())) {
      found.push(marker);
    }
  }
  return found;
}
