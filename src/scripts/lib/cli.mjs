export const EXIT = {
  ok: 0,
  actionFailed: 1,
  usage: 2,
  ambiguous: 3,
  internal: 4,
};

export function parseArgs(argv) {
  const args = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        const idx = arg.indexOf('=');
        const key = arg.slice(2, idx);
        const value = arg.slice(idx + 1);
        args[key] = value;
        continue;
      }

      const key = arg.slice(2);
      const next = argv[i + 1];

      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(arg);
    }
  }

  return args;
}

function normalizeEnvelope(payload = {}) {
  const data = {
    ...(payload.data && typeof payload.data === 'object' ? payload.data : {}),
  };

  delete data.next;
  delete data.next_action;

  if (payload._debug !== undefined) {
    data._debug = payload._debug;
  }

  let instructions =
    payload.instructions ??
    payload.instructions_for_llm ??
    payload.skill_instructions?.markdown ??
    '';

  if (
    !instructions &&
    Array.isArray(payload.errors) &&
    payload.errors.length > 0 &&
    payload.errors[0]?.message
  ) {
    instructions = payload.errors[0].message;
  }

  const validStates = ['ok', 'in_progress', 'blocked', 'complete'];

  let state = payload.state;

  if (!validStates.includes(state)) {
    const candidate = payload.status ?? payload.gate_status;

    if (validStates.includes(candidate)) {
      state = candidate;
    } else if (candidate === 'pass' || candidate === 'accepted') {
      state = 'complete';
    } else if (candidate === 'fail' || candidate === 'rejected') {
      state = 'blocked';
    } else {
      state =
        Array.isArray(payload.errors) && payload.errors.length > 0
          ? 'blocked'
          : 'ok';
    }
  }

  return {
    workflow: payload.workflow ?? payload.stage ?? 'cli',
    step: payload.step ?? 'step',
    state,
    instructions: String(instructions || ''),
    data,
    errors: Array.isArray(payload.errors) ? payload.errors : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
  };
}

export function writeJson(payload, code = EXIT.ok) {
  const envelope = normalizeEnvelope(payload);

  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.exit(code);
}
