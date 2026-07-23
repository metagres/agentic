import { nextId, nextIdsFromArrays, today } from '../lib/ids.mjs';
import { deltaComplete, titleFromRequest } from '../lib/stage-helpers.mjs';

function discoveryGate(artifact) {
  const log = Array.isArray(artifact?.discovery_log)
    ? artifact.discovery_log
    : [];

  const resolved = log.filter((entry) => entry?.resolved === true);
  const lenses = new Set(resolved.map((entry) => entry?.lens));

  const clarity = artifact?.metadata?.clarity || 'partial';

  const requiredByClarity = {
    clear: ['failure', 'constraint'],
    partial: ['stakeholder', 'interface', 'failure', 'constraint'],
    vague: [
      'stakeholder',
      'scope',
      'interface',
      'behavior',
      'failure',
      'constraint',
    ],
  };

  const required = requiredByClarity[clarity] || requiredByClarity.partial;
  const missing = required.filter((lens) => !lenses.has(lens));

  const minimumByClarity = {
    clear: 3,
    partial: 5,
    vague: 8,
  };

  const minimum = minimumByClarity[clarity] || 5;

  return {
    passed: missing.length === 0 && resolved.length >= minimum,
    clarity,
    required_lenses: required,
    missing_lenses: missing,
    resolved_questions: resolved.length,
    minimum_questions: minimum,
  };
}

function assumptionsComplete(artifact) {
  if (!Array.isArray(artifact?.assumptions)) return false;

  return (
    artifact.assumptions.length > 0 ||
    artifact?.metadata?.assumptions_reviewed === true
  );
}

function draftComplete(artifact) {
  const frCount = Array.isArray(artifact?.functional_requirements)
    ? artifact.functional_requirements.length
    : 0;

  const nfrCount = Array.isArray(artifact?.non_functional_requirements)
    ? artifact.non_functional_requirements.length
    : 0;

  const acCount = Array.isArray(artifact?.acceptance_criteria)
    ? artifact.acceptance_criteria.length
    : 0;

  const hasProblemStatement = Boolean(
    artifact?.problem_statement &&
      String(artifact.problem_statement).trim()
  );

  return hasProblemStatement && frCount + nfrCount > 0 && acCount > 0;
}

export const requirementsStage = {
  id: 'requirements',
  artifactFile: 'requirements.yaml',
  contractFile: 'requirements-contract.yaml',
  deltaPhase: 'Requirements',

  stepIds: [
    'needs_input',
    'init',
    'discovery',
    'assumptions',
    'drafting',
    'validation',
    'delta',
    'recovery',
    'ready',
    'complete',
  ],

  stepDefinitions: {
    needs_input: {
      title: 'Needs input',
      next_action: 'provide_change_or_request',
      markdown: `
Ask the user whether this is an existing change or a new request.

For an existing change, present \`data.existing_changes\` and ask the user to choose one.

For a new request, ask the user for the request text.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir <change-dir>',
        '{{SDLC}} requirements --request "<request text>"',
      ],
    },

    init: {
      title: 'Initialization',
      next_action: 'initialize_context',
      markdown: `
The script created the initial requirements artifact.

Read \`docs/current/index.md\` and use it to decide which living docs are relevant.
Read only what is needed for this request.
`.trim(),
      commands: ['{{SDLC}} requirements --dir {{change_dir}}'],
    },

    discovery: {
      title: 'Discovery',
      next_action: 'ask_user_question',
      markdown: `
Ask the user one question at a time.

Record each resolved answer through the script. The script allocates the next DL-NNN id.

Do not stop until \`data.discovery_gate.passed\` is true.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --record-answer --lens <lens> --question "<question>" --answer "<answer>"',
        '{{SDLC}} requirements --dir {{change_dir}} --set-clarity <clear|partial|vague>',
      ],
      exit_criteria: {
        field: 'data.discovery_gate.passed',
        equals: true,
      },
    },

    assumptions: {
      title: 'Assumptions',
      next_action: 'record_assumptions_or_complete_step',
      markdown: `
List every assumption implied by the request and discovery answers.

Classify each assumption as verified or unverified.

If there are genuinely no assumptions, mark the step complete.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --update-artifact < requirements.yaml',
        '{{SDLC}} requirements --dir {{change_dir}} --complete-step --step assumptions',
      ],
    },

    drafting: {
      title: 'Drafting',
      next_action: 'update_artifact',
      markdown: `
Draft the full requirements artifact.

Use \`data.next_ids\` to choose the next FR/NFR/AC ids.

Write the artifact through the script.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --next-ids',
        '{{SDLC}} requirements --dir {{change_dir}} --update-artifact < requirements.yaml',
      ],
    },

    validation: {
      title: 'Validation',
      next_action: 'fix_mechanical_errors_or_record_semantic_result',
      markdown: `
Fix mechanical validation errors first.

Then evaluate each semantic check in \`data.semantic_checks_to_run\` and record each result with evidence.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --record-semantic-result --check <check_id> --status pass --evidence "<evidence>"',
      ],
    },

    delta: {
      title: 'Delta',
      next_action: 'append_delta_or_complete_step',
      markdown: `
Determine which living docs are affected.

Use \`data.delta_allowed_target_docs\` as the allowed target docs.

Append delta entries through the script.

If no docs are affected, mark the step complete.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --append-delta < delta.yaml',
        '{{SDLC}} requirements --dir {{change_dir}} --complete-step --step delta',
      ],
    },

    recovery: {
      title: 'Recovery',
      next_action: 'fix_review_findings',
      markdown: `
The artifact was rejected by review.

Read \`data.review_report\` and fix each blocking finding.

Update the artifact through the script, then finalize again.

If the artifact was rejected, finalizing automatically applies a patch version bump unless you pass --bump-version.
`.trim(),
      commands: [
        '{{SDLC}} requirements --dir {{change_dir}} --update-artifact < requirements.yaml',
        '{{SDLC}} requirements --dir {{change_dir}} --finalize',
      ],
    },

    ready: {
      title: 'Ready',
      next_action: 'finalize',
      markdown: `
All gates passed.

Finalize the artifact.
`.trim(),
      commands: ['{{SDLC}} requirements --dir {{change_dir}} --finalize'],
    },

    complete: {
      title: 'Complete',
      next_action: 'invoke_review',
      markdown: `
The requirements artifact is ready for the review gate.
`.trim(),
      commands: ['{{SDLC}} review --target requirements --dir {{change_dir}}'],
    },
  },

  initialArtifact(request, env) {
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
      semantic_validation: [],
    };
  },

  nextIds(artifact) {
    return nextIdsFromArrays(artifact, {
      FR: 'functional_requirements',
      NFR: 'non_functional_requirements',
      AC: 'acceptance_criteria',
      DL: 'discovery_log',
    });
  },

  recordAnswer(env) {
    const lens = env.args.lens;
    const question = env.args.question;
    const answer = env.args.answer;

    if (!lens || !question || !answer) {
      throw new Error(
        '--record-answer requires --lens, --question, and --answer.'
      );
    }

    if (!Array.isArray(env.artifact.discovery_log)) {
      env.artifact.discovery_log = [];
    }

    const id = nextId(
      env.artifact.discovery_log.map((entry) => entry.id),
      'DL'
    );

    env.artifact.discovery_log.push({
      id,
      question: String(question),
      answer: String(answer),
      lens: String(lens),
      resolved: true,
    });
  },

  setClarity(env) {
    const clarity = env.args['set-clarity'];

    if (!['clear', 'partial', 'vague'].includes(clarity)) {
      throw new Error('--set-clarity must be clear, partial, or vague.');
    }

    env.artifact.metadata.clarity = clarity;
  },

  detectStep(env) {
    if (!env.changeRoot) return 'needs_input';

    const artifact = env.artifact;

    if (!artifact) return 'init';

    if (artifact.metadata?.status === 'rejected') return 'recovery';

    if (!artifact.metadata?.title || !artifact.metadata?.request_summary) {
      return 'init';
    }

    if (!discoveryGate(artifact).passed) return 'discovery';

    if (!assumptionsComplete(artifact)) return 'assumptions';

    if (!draftComplete(artifact)) return 'drafting';

    const blockingCount = env.blocking?.length || 0;
    const semanticComplete = env.semantic?.complete ?? false;

    if (blockingCount > 0 || !semanticComplete) return 'validation';

    if (!deltaComplete(artifact)) return 'delta';

    if (
      artifact.metadata?.status === 'ready-for-review' ||
      artifact.metadata?.status === 'accepted'
    ) {
      return 'complete';
    }

    return 'ready';
  },

  isReadyForReview(env) {
    const artifact = env.artifact;
    const reasons = [];

    if (!assumptionsComplete(artifact)) {
      reasons.push('assumptions are not complete');
    }

    if (!draftComplete(artifact)) {
      reasons.push('requirements draft is not complete');
    }

    const blockingCount = env.blocking?.length || 0;

    if (blockingCount > 0) {
      reasons.push(`${blockingCount} blocking mechanical finding(s)`);
    }

    if (!env.semantic?.complete) {
      const missing = (env.semantic?.missing || []).join(', ');
      const failed = (env.semantic?.failed || []).join(', ');

      reasons.push(
        `semantic validation incomplete (missing: ${missing || 'none'}, failed: ${failed || 'none'})`
      );
    }

    if (!deltaComplete(artifact)) {
      reasons.push('delta is not complete');
    }

    return {
      ready: reasons.length === 0,
      reasons,
    };
  },

  getData(env) {
    const artifact = env.artifact || {};

    return {
      discovery_gate: discoveryGate(artifact),
      assumptions_complete: assumptionsComplete(artifact),
      draft_complete: draftComplete(artifact),
      mechanical_valid: (env.blocking?.length || 0) === 0,
      semantic_complete: Boolean(env.semantic?.complete),
      delta_complete: deltaComplete(artifact),
    };
  },
};
