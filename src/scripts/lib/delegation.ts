import type { StageRecord } from './stage-registry.ts';

/**
 * CMP-001: pure delegation-directive composer (DM-003).
 *
 * Composes the delegation directive deterministically from StageRecord fields
 * only (id, kind, agent). A null agent binding yields null, so unbound stages
 * and cross-cutting commands stay silent (FR-002). A non-null binding yields a
 * directive naming the bound agent that instructs the caller to delegate the
 * stage to that agent unless the caller already is that agent (self clause,
 * AC-002) or that agent is not present or not invocable in the runtime
 * (unavailability clause, AC-011), in which case the caller proceeds running
 * the stage itself. Review-kind stages carry the reviewer-directed variant:
 * the review round must be performed by the named reviewer agent rather than
 * by the agent that authored the artifact (FR-003).
 *
 * The text is always interpolated from the binding — no hardcoded agent ids or
 * paths (NFR-002) — so directives cannot drift from the declarative bindings.
 * Identical inputs produce identical text.
 */
export function delegationDirective(
  stage: Pick<StageRecord, 'id' | 'kind' | 'agent'>
): string | null {
  if (!stage.agent) {
    return null;
  }

  const agent = stage.agent;
  const selfClause = `if you are already ${agent}, proceed running the stage yourself`;
  const availabilityClause = `if ${agent} is not present or not invocable in your runtime, proceed running the stage yourself`;

  if (stage.kind === 'review') {
    return (
      `Stage '${stage.id}' is bound to the reviewer agent '${agent}': delegate this review round to ${agent} and run the stage via that agent; ` +
      `the review round must be performed by ${agent}, not by the agent that authored the artifact; ` +
      `${selfClause}; ${availabilityClause}.`
    );
  }

  return (
    `Stage '${stage.id}' is bound to the dedicated agent '${agent}': delegate this stage to ${agent} and run the stage via that agent; ` +
    `${selfClause}; ${availabilityClause}.`
  );
}
