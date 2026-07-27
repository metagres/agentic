export function assertTransition(lifecycle: Record<string, unknown>, statusKind: string, from: string | undefined, to: string): void {
  if (from === to) {
    return;
  }

  const machine = lifecycle?.[statusKind] as Record<string, unknown> | undefined;
  if (!machine || typeof machine !== 'object' || !(machine as Record<string, unknown>).transitions) {
    // If lifecycle policy is unavailable, do not block existing behavior.
    return;
  }

  const machineRecord = machine as Record<string, unknown>;
  const current = from || (machineRecord.initial as string);
  const allowed = (machineRecord.transitions as Record<string, string[]>)[current] || [];

  if (!allowed.includes(to)) {
    const err = new Error(
      `Illegal ${statusKind} transition: ${current || 'unknown'} -> ${to}`
    ) as NodeJS.ErrnoException;
    err.code = 'ILLEGAL_STATUS_TRANSITION';
    throw err;
  }
}
