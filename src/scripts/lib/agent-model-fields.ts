/**
 * Engine-level cross-check helpers for the agent descriptor model fields
 * (DEC-003): model_override must be a non-empty free-form string when present,
 * and model must be a member of the current catalog enum. Pure and
 * deterministic — no LLM or network calls (NFR-002); consumed by
 * bin/validate-policies.ts and unit-tested directly.
 */

export const AGENT_MODEL_OVERRIDE_EMPTY = 'AGENT_MODEL_OVERRIDE_EMPTY';
export const AGENT_MODEL_OUTSIDE_CATALOG = 'AGENT_MODEL_OUTSIDE_CATALOG';

/** One deterministic finding: a stable code plus a message naming file and value. */
export interface ModelFieldFinding {
  code: typeof AGENT_MODEL_OVERRIDE_EMPTY | typeof AGENT_MODEL_OUTSIDE_CATALOG;
  finding: string;
}

/**
 * checkAgentModelFields(descriptor, label, catalogModels): validates one parsed
 * agent descriptor's model fields.
 *
 * - model_override, when present, must be a non-empty string; the empty string
 *   yields AGENT_MODEL_OVERRIDE_EMPTY naming the file and the empty value.
 * - model must be a member of the supplied catalog enum; a miss yields
 *   AGENT_MODEL_OUTSIDE_CATALOG naming the file and the offending value.
 * - Free-form non-empty overrides never fail here: model_override is
 *   deliberately not enum-checked (DEC-003).
 */
export function checkAgentModelFields(
  descriptor: Record<string, unknown>,
  label: string,
  catalogModels: readonly string[]
): ModelFieldFinding[] {
  const findings: ModelFieldFinding[] = [];

  const override = descriptor.model_override;
  if (override !== undefined && (typeof override !== 'string' || override.length === 0)) {
    findings.push({
      code: AGENT_MODEL_OVERRIDE_EMPTY,
      finding: `${label} model_override must be a non-empty string but is '${String(override)}'`,
    });
  }

  const model = descriptor.model;
  if (typeof model === 'string' && !catalogModels.includes(model)) {
    findings.push({
      code: AGENT_MODEL_OUTSIDE_CATALOG,
      finding: `${label} model '${model}' is not a member of the current catalog enum`,
    });
  }

  return findings;
}
