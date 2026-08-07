import { nextId, nextIdsFromArrays, today } from '../lib/ids.ts';
import { deltaComplete, titleFromRequest } from '../lib/stage-helpers.ts';
// sdlc-hardening: policy
import { loadRequirementsPolicy } from '../lib/policy-loader.ts';
import { detectStep, isReadyForReview, getData } from '../lib/authoring-base.ts';
import type { AuthoringStageConfig } from '../lib/authoring-base.ts';

function discoveryGate(artifact: Record<string, unknown>) {
  const log = Array.isArray(artifact?.discovery_log)
    ? (artifact.discovery_log as Record<string, unknown>[])
    : [];
  const resolved = log.filter((entry: Record<string, unknown>) => entry?.resolved === true);
  const lenses = new Set(resolved.map((entry: Record<string, unknown>) => entry?.lens));
  const metadata = (artifact?.metadata as Record<string, unknown>) || {};
  const clarity = (metadata?.clarity as string) || 'partial';

  let policy: Record<string, unknown> | null = null;
  try {
    policy = loadRequirementsPolicy(process.cwd()) as Record<string, unknown>;
  } catch {
    policy = null;
  }

  const fallback: Record<string, { required_lenses: string[]; min_resolved_questions: number }> = {
    clear: {
      required_lenses: ['failure', 'constraint'],
      min_resolved_questions: 3,
    },
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
    ((policy?.discovery as Record<string, unknown>)?.clarity as Record<string, { required_lenses: string[]; min_resolved_questions: number }>)?.[clarity] ||
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

function assumptionsComplete(artifact: Record<string, unknown>) {
  if (!Array.isArray(artifact?.assumptions)) return false;

  const metadata = (artifact?.metadata as Record<string, unknown>) || {};

  return (
    (artifact.assumptions as unknown[]).length > 0 ||
    metadata?.assumptions_reviewed === true
  );
}

function draftComplete(artifact: Record<string, unknown>) {
  const frCount = Array.isArray(artifact?.functional_requirements)
    ? (artifact.functional_requirements as unknown[]).length
    : 0;

  const nfrCount = Array.isArray(artifact?.non_functional_requirements)
    ? (artifact.non_functional_requirements as unknown[]).length
    : 0;

  const acCount = Array.isArray(artifact?.acceptance_criteria)
    ? (artifact.acceptance_criteria as unknown[]).length
    : 0;

  const hasProblemStatement = Boolean(
    artifact?.problem_statement &&
      String(artifact.problem_statement).trim()
  );

  return hasProblemStatement && frCount + nfrCount > 0 && acCount > 0;
}

const config: AuthoringStageConfig = {
  id: 'requirements',
  artifactFile: 'requirements.yaml',
  deltaPhase: 'Requirements',
  initComplete: (artifact) => {
    const metadata = (artifact.metadata as Record<string, unknown>) || {};
    return Boolean(metadata?.title && metadata?.request_summary);
  },
  draftComplete,
  extraStep: (env) => {
    const artifact = env.artifact as Record<string, unknown>;
    if (!discoveryGate(artifact).passed) return 'discovery';
    if (!assumptionsComplete(artifact)) return 'assumptions';
    return null;
  },
  getExtraData: (env) => {
    const artifact = (env.artifact || {}) as Record<string, unknown>;
    return {
      discovery_gate: discoveryGate(artifact),
      assumptions_complete: assumptionsComplete(artifact),
    };
  },
};

export const requirementsStage = {
  ...config,
  initialArtifact(request: string, env: Record<string, unknown>) {
    return {
      metadata: {
        id: 'REQ-001',
        title: titleFromRequest(request, 'Untitled requirement'),
        stage: 'requirements',
        step: 'init',
        status: 'draft',
        version: '0.1.0',
        created: today(),
        updated: today(),
        request_summary: String(request || '').trim(),
        clarity: 'partial',
        assumptions_reviewed: false,
        delta_reviewed: false,
      },
      problem_statement: '',
      discovery_log: [],
      assumptions: [],
      functional_requirements: [],
      non_functional_requirements: [],
      acceptance_criteria: [],
      out_of_scope: [],
      failure_paths: [],
      risks_and_dependencies: [],
      delta: [],
    };
  },

  nextIds(artifact: Record<string, unknown>) {
    return nextIdsFromArrays(artifact, {
      FR: 'functional_requirements',
      NFR: 'non_functional_requirements',
      AC: 'acceptance_criteria',
      DL: 'discovery_log',
    });
  },

  recordAnswer(env: Record<string, unknown>) {
    const args = (env.args || {}) as Record<string, unknown>;
    const lens = args.lens as string;
    const question = args.question as string;
    const answer = args.answer as string;

    if (!lens || !question || !answer) {
      throw new Error(
        '--record-answer requires --lens, --question, and --answer.'
      );
    }

    const artifact = env.artifact as Record<string, unknown>;

    if (!Array.isArray(artifact.discovery_log)) {
      artifact.discovery_log = [];
    }

    const discoveryLog = artifact.discovery_log as Array<Record<string, unknown>>;

    const id = nextId(
      discoveryLog.map((entry) => entry.id as string) as never[],
      'DL'
    );

    discoveryLog.push({
      id,
      question: String(question),
      answer: String(answer),
      lens: String(lens),
      resolved: true,
    });
  },

  setClarity(env: Record<string, unknown>) {
    const args = (env.args || {}) as Record<string, unknown>;
    const clarity = args['set-clarity'] as string;

    if (!['clear', 'partial', 'vague'].includes(clarity)) {
      throw new Error('--set-clarity must be clear, partial, or vague.');
    }

    const artifact = env.artifact as Record<string, unknown>;
    const metadata = (artifact.metadata as Record<string, unknown>) || {};
    metadata.clarity = clarity;
  },

  detectStep: (env: Record<string, unknown>) => detectStep(env, config),
  isReadyForReview: (env: Record<string, unknown>) => isReadyForReview(env, config),
  getData: (env: Record<string, unknown>) => getData(env, config),
};