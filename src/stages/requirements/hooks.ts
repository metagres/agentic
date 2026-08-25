// Optional hooks module for the requirements stage (DEC-016). This is the only
// stage-specific code allowed and never participates in validation. It supplies
// the fail-loud discovery policy loader (CMP-002), the confirmed discovery gate
// (CMP-003), record-answer, set-clarity, and extra-step behavior that no
// declarative predicate expresses.
import fs from 'node:fs';
import path from 'node:path';

interface HookEnv {
  [key: string]: unknown;
}

interface ClarityPolicy {
  required_lenses?: string[];
  min_resolved_questions?: number;
}

interface DiscoveryPolicy {
  version?: number;
  discovery?: {
    lenses?: string[];
    clarity?: Record<string, ClarityPolicy>;
  };
}

// Cached per policy file path for the lifetime of the process (each CLI
// invocation is a fresh process). Keyed by path so unit tests exercising
// distinct fixture stage folders do not poison each other's cache.
const policyCache = new Map<string, DiscoveryPolicy>();

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

// Loads and validates requirements-policy.yaml (CMP-002, DEC-001, DEC-002).
// Fail-loud: a missing file throws STAGE_POLICY_MISSING; an unparsable file or
// a shape violation throws STAGE_POLICY_INVALID naming the offending field.
// The silent fallback constants are deliberately removed so shipped discovery
// behavior can never drift from the policy file.
function loadPolicy(env: HookEnv): DiscoveryPolicy {
  const stage = (env.stage || {}) as { folder?: string };
  const abs = path.join(stage.folder || '', 'requirements-policy.yaml');

  const cached = policyCache.get(abs);
  if (cached) return cached;

  if (!fs.existsSync(abs)) {
    throw codedError(
      'STAGE_POLICY_MISSING',
      `requirements-policy.yaml is missing from the requirements stage folder (${abs}).`
    );
  }

  const readYaml = env.readYaml as ((file: string) => unknown) | undefined;
  if (!readYaml) {
    throw new Error('Policy loading requires env.readYaml.');
  }

  const doc = readYaml(abs) as unknown;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw codedError(
      'STAGE_POLICY_INVALID',
      `requirements-policy.yaml could not be parsed as a mapping (${abs}).`
    );
  }

  validatePolicyShape(doc as Record<string, unknown>);
  policyCache.set(abs, doc as DiscoveryPolicy);
  return doc as DiscoveryPolicy;
}

// Shape validation for requirements-policy.yaml (DM-001, DEC-010). Every
// violation throws STAGE_POLICY_INVALID naming the offending field path.
function validatePolicyShape(doc: Record<string, unknown>): void {
  const fail = (field: string, reason: string): never => {
    throw codedError(
      'STAGE_POLICY_INVALID',
      `requirements-policy.yaml field '${field}' is invalid: ${reason}.`
    );
  };

  if (doc.version !== 1) fail('version', 'must be 1');

  const discovery = doc.discovery;
  if (!discovery || typeof discovery !== 'object' || Array.isArray(discovery)) {
    fail('discovery', 'must be a mapping');
  }
  const disc = discovery as Record<string, unknown>;

  const lenses = disc.lenses;
  if (!Array.isArray(lenses) || lenses.length === 0) {
    fail('discovery.lenses', 'must be a non-empty array');
  }
  if (!(lenses as unknown[]).every((l) => typeof l === 'string' && l.length > 0)) {
    fail('discovery.lenses', 'must contain only non-empty strings');
  }
  const lensSet = new Set(lenses as string[]);
  if (lensSet.size !== (lenses as string[]).length) {
    fail('discovery.lenses', 'must not contain duplicates');
  }

  const clarity = disc.clarity;
  if (!clarity || typeof clarity !== 'object' || Array.isArray(clarity)) {
    fail('discovery.clarity', 'must be a mapping');
  }
  const anchorNames = Object.keys(clarity as Record<string, unknown>).sort();
  const expectedAnchors = ['clear', 'partial', 'vague'].sort();
  if (JSON.stringify(anchorNames) !== JSON.stringify(expectedAnchors)) {
    fail('discovery.clarity', 'must define exactly the anchors clear, partial, and vague');
  }

  for (const name of Object.keys(clarity as Record<string, unknown>)) {
    const anchor = (clarity as Record<string, unknown>)[name];
    if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) {
      fail(`discovery.clarity.${name}`, 'must be a mapping');
    }
    const a = anchor as Record<string, unknown>;

    const required = a.required_lenses;
    if (!Array.isArray(required) || required.length === 0) {
      fail(`discovery.clarity.${name}.required_lenses`, 'must be a non-empty array');
    }
    for (const lens of required as unknown[]) {
      if (typeof lens !== 'string' || !lensSet.has(lens)) {
        fail(
          `discovery.clarity.${name}.required_lenses`,
          `references lens '${String(lens)}' which is not in discovery.lenses`
        );
      }
    }
    if (new Set(required as string[]).size !== (required as string[]).length) {
      fail(`discovery.clarity.${name}.required_lenses`, 'must not contain duplicates');
    }

    const min = a.min_resolved_questions;
    if (typeof min !== 'number' || !Number.isInteger(min) || min < 1) {
      fail(`discovery.clarity.${name}.min_resolved_questions`, 'must be a positive integer');
    }
  }
}

interface DiscoveryEntry {
  resolved?: boolean;
  lens?: string;
}

interface DiscoveryGateResult {
  passed: boolean;
  clarity: string;
  clarity_valid: boolean;
  required_lenses: string[];
  missing_lenses: string[];
  resolved_questions: number;
  minimum_questions: number;
  confirmed: boolean;
}

// Confirmed discovery gate (CMP-003, DEC-003, DEC-010): the policy floor
// (required lenses covered and minimum resolved questions met) plus the
// explicit confirmation flag. An artifact clarity that is not a policy anchor
// fails the gate with clarity_valid false instead of silently defaulting.
function discoveryGate(env: HookEnv): DiscoveryGateResult {
  const policy = loadPolicy(env);

  const artifact = (env.artifact || {}) as Record<string, unknown>;
  const log = Array.isArray(artifact.discovery_log)
    ? (artifact.discovery_log as DiscoveryEntry[])
    : [];
  const resolved = log.filter((entry) => entry && entry.resolved === true);
  const lenses = new Set(resolved.map((entry) => entry && entry.lens));
  const metadata = (artifact.metadata || {}) as Record<string, unknown>;
  const clarity = String(metadata.clarity || '');
  const confirmed = metadata.discovery_reviewed === true;

  const anchor = policy.discovery?.clarity?.[clarity];

  if (!anchor) {
    return {
      passed: false,
      clarity,
      clarity_valid: false,
      required_lenses: [],
      missing_lenses: [],
      resolved_questions: resolved.length,
      minimum_questions: 0,
      confirmed,
    };
  }

  const required = anchor.required_lenses || [];
  const missing = required.filter((lens) => !lenses.has(lens));
  const minimum = Number(anchor.min_resolved_questions || 0);

  return {
    passed: missing.length === 0 && resolved.length >= minimum,
    clarity,
    clarity_valid: true,
    required_lenses: required,
    missing_lenses: missing,
    resolved_questions: resolved.length,
    minimum_questions: minimum,
    confirmed,
  };
}

function assumptionsComplete(artifact: Record<string, unknown>): boolean {
  if (!Array.isArray(artifact && artifact.assumptions)) return false;
  const metadata = ((artifact && artifact.metadata) || {}) as Record<string, unknown>;
  return (
    (artifact.assumptions as unknown[]).length > 0 ||
    metadata.assumptions_reviewed === true
  );
}

// Scenarios step activation (CMP-004, DEC-004, DEC-008, FR-006): active while
// any scenario has status open, or while the scenarios array is empty and the
// set was not explicitly confirmed with --complete-step --step scenarios.
function scenariosActive(artifact: Record<string, unknown>): boolean {
  const scenarios = Array.isArray(artifact.scenarios)
    ? (artifact.scenarios as { status?: string }[])
    : [];
  const metadata = ((artifact && artifact.metadata) || {}) as Record<string, unknown>;
  if (scenarios.some((s) => s && s.status === 'open')) return true;
  if (scenarios.length === 0 && metadata.scenarios_reviewed !== true) return true;
  return false;
}

// Envelope-facing scenarios state (DM-005): counts, the reviewed flag, and the
// routing decision.
function scenariosState(artifact: Record<string, unknown>): {
  total: number;
  open: number;
  resolved: number;
  reviewed: boolean;
  needs_attention: boolean;
} {
  const scenarios = Array.isArray(artifact.scenarios)
    ? (artifact.scenarios as { status?: string }[])
    : [];
  const metadata = ((artifact && artifact.metadata) || {}) as Record<string, unknown>;
  const open = scenarios.filter((s) => s && s.status === 'open').length;
  return {
    total: scenarios.length,
    open,
    resolved: scenarios.length - open,
    reviewed: metadata.scenarios_reviewed === true,
    needs_attention: scenariosActive(artifact),
  };
}

export default {
  // Stage startup hook (CMP-002, DEC-002): invoked once per authoring command
  // after the stage environment is constructed. Loads and validates the
  // discovery policy; any failure blocks the stage with a coded error.
  startup(env: HookEnv) {
    loadPolicy(env);
  },

  extraStep(env: HookEnv) {
    const artifact = (env.artifact || {}) as Record<string, unknown>;
    const metadata = (artifact.metadata || {}) as Record<string, unknown>;
    const gate = discoveryGate(env);
    if (!gate.passed || metadata.discovery_reviewed !== true) return 'discovery';
    if (scenariosActive(artifact)) return 'scenarios';
    if (!assumptionsComplete(artifact)) return 'assumptions';
    return null;
  },

  getExtraData(env: HookEnv) {
    return {
      discovery_gate: discoveryGate(env),
      scenarios_state: scenariosState(
        (env.artifact || {}) as Record<string, unknown>
      ),
      assumptions_complete: assumptionsComplete(
        (env.artifact || {}) as Record<string, unknown>
      ),
    };
  },

  recordAnswer(env: HookEnv) {
    const policy = loadPolicy(env);
    const args = (env.args || {}) as Record<string, unknown>;
    const lens = args.lens as string | undefined;
    const question = args.question as string | undefined;
    const answer = args.answer as string | undefined;

    if (!lens || !question || !answer) {
      throw new Error(
        '--record-answer requires --lens, --question, and --answer.'
      );
    }

    const validLenses = (policy.discovery?.lenses || []) as string[];
    if (!validLenses.includes(lens)) {
      throw codedError(
        'UNKNOWN_LENS',
        `Lens '${lens}' is not in the policy vocabulary. Valid lenses: ${validLenses.join(', ')}.`
      );
    }

    const artifact = (env.artifact || {}) as Record<string, unknown>;
    if (!Array.isArray(artifact.discovery_log)) {
      artifact.discovery_log = [];
    }

    const ids = (artifact.discovery_log as { id?: unknown }[]).map(
      (entry) => entry.id
    );
    let max = 0;
    for (const id of ids) {
      if (typeof id === 'string' && id.startsWith('DL-')) {
        const n = Number(id.slice(3));
        if (Number.isInteger(n) && n > max) max = n;
      }
    }

    (artifact.discovery_log as Record<string, unknown>[]).push({
      id: `DL-${String(max + 1).padStart(3, '0')}`,
      question: String(question),
      answer: String(answer),
      lens: String(lens),
      resolved: true,
    });
  },

  setClarity(env: HookEnv) {
    const policy = loadPolicy(env);
    const args = (env.args || {}) as Record<string, unknown>;
    const clarity = args['set-clarity'] as string | undefined;

    const anchors = Object.keys((policy.discovery?.clarity as Record<string, unknown>) || {});
    if (!anchors.includes(String(clarity))) {
      throw new Error(`--set-clarity must be one of: ${anchors.join(', ')}.`);
    }

    const artifact = (env.artifact || {}) as Record<string, unknown>;
    const metadata = (artifact.metadata || {}) as Record<string, unknown>;
    metadata.clarity = clarity;
  },
};
