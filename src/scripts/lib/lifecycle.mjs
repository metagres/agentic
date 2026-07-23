export function assertTransition(lifecycle, statusKind, from, to) {
  if (from === to) {
    return;
  }

  const machine = lifecycle?.[statusKind];
  if (!machine || typeof machine !== 'object' || !machine.transitions) {
    // If lifecycle policy is unavailable, do not block existing behavior.
    return;
  }

  const current = from || machine.initial;
  const allowed = machine.transitions[current] || [];

  if (!allowed.includes(to)) {
    const err = new Error(
      `Illegal ${statusKind} transition: ${current || 'unknown'} -> ${to}`
    );
    err.code = 'ILLEGAL_STATUS_TRANSITION';
    throw err;
  }
}
