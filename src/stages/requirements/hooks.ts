// Optional hooks module for the requirements stage (DEC-016). This is the only
// stage-specific code allowed and never participates in validation. It supplies
// the discovery gate, record-answer, set-clarity, and extra-step behavior that
// no declarative predicate expresses.
import path from 'node:path';

interface HookEnv {
  [key: string]: unknown;
}

interface DiscoveryPolicy {
  discovery?: {
    clarity?: Record<
      string,
      { required_lenses?: string[]; min_resolved_questions?: number }
    >;
  };
}

function loadPolicy(env: HookEnv): DiscoveryPolicy | null {
  const stage = (env.stage || {}) as { folder?: string };
  const abs = path.join(stage.folder || '', 'requirements-policy.yaml');
  try {
    const readYaml = env.readYaml as ((file: string) => unknown) | undefined;
    return (readYaml ? readYaml(abs) : null) as DiscoveryPolicy | null;
  } catch {
    return null;
  }
}

interface DiscoveryEntry {
  resolved?: boolean;
  lens?: string;
}

function discoveryGate(env: HookEnv) {
  const artifact = (env.artifact || {}) as Record<string, unknown>;
  const log = Array.isArray(artifact.discovery_log)
    ? (artifact.discovery_log as DiscoveryEntry[])
    : [];
  const resolved = log.filter((entry) => entry && entry.resolved === true);
  const lenses = new Set(resolved.map((entry) => entry && entry.lens));
  const metadata = (artifact.metadata || {}) as Record<string, unknown>;
  const clarity = String(metadata.clarity || 'partial');

  const policy = loadPolicy(env);

  const fallback: Record<
    string,
    { required_lenses: string[]; min_resolved_questions: number }
  > = {
    clear: { required_lenses: ['failure', 'constraint'], min_resolved_questions: 3 },
    partial: {
      required_lenses: ['stakeholder', 'interface', 'failure', 'constraint'],
      min_resolved_questions: 5,
    },
    vague: {
      required_lenses: [
        'stakeholder',
        'scope',
        'interface',
        'behavior',
        'failure',
        'constraint',
      ],
      min_resolved_questions: 8,
    },
  };

  const clarityPolicy =
    (policy &&
      policy.discovery &&
      policy.discovery.clarity &&
      policy.discovery.clarity[clarity]) ||
    fallback[clarity] ||
    fallback.partial;

  const required = clarityPolicy.required_lenses || [];
  const missing = required.filter((lens: string) => !lenses.has(lens));
  const minimum = Number(clarityPolicy.min_resolved_questions || 5);

  return {
    passed: missing.length === 0 && resolved.length >= minimum,
    clarity,
    required_lenses: required,
    missing_lenses: missing,
    resolved_questions: resolved.length,
    minimum_questions: minimum,
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

export default {
  extraStep(env: HookEnv) {
    const artifact = (env.artifact || {}) as Record<string, unknown>;
    if (!discoveryGate(env).passed) return 'discovery';
    if (!assumptionsComplete(artifact)) return 'assumptions';
    return null;
  },

  getExtraData(env: HookEnv) {
    return {
      discovery_gate: discoveryGate(env),
      assumptions_complete: assumptionsComplete(
        (env.artifact || {}) as Record<string, unknown>
      ),
    };
  },

  recordAnswer(env: HookEnv) {
    const args = (env.args || {}) as Record<string, unknown>;
    const lens = args.lens as string | undefined;
    const question = args.question as string | undefined;
    const answer = args.answer as string | undefined;

    if (!lens || !question || !answer) {
      throw new Error(
        '--record-answer requires --lens, --question, and --answer.'
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
    const args = (env.args || {}) as Record<string, unknown>;
    const clarity = args['set-clarity'] as string | undefined;

    if (!['clear', 'partial', 'vague'].includes(String(clarity))) {
      throw new Error('--set-clarity must be clear, partial, or vague.');
    }

    const artifact = (env.artifact || {}) as Record<string, unknown>;
    const metadata = (artifact.metadata || {}) as Record<string, unknown>;
    metadata.clarity = clarity;
  },
};
