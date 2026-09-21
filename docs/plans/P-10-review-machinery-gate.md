# P-10 — Review machinery: review `sdlc write` and `sdlc gate`

P-10

### Goal
Implement review rounds, gate evaluation, and round caps.

### Deliverables
- Review-stage behavior for `sdlc write`:
  - one call creates exactly one round;
  - CLI computes:
    - review artifact `revision`;
    - round number;
    - `reviewed_revision`;
    - `gate_cleared`;
  - reviewer supplies:
    - `findings`;
    - `observations`;
    - `checks_answered`.
- `sdlc gate <slug> <stage>`:
  - evaluates validator state for target and latest review round;
  - does not mutate state;
  - exit 7 when gate closed or workflow blocked.
- Round cap:
  - `review.max_rounds` from `policy_snapshot`;
  - closed latest round at cap derives `blocked`.

### Testable acceptance criteria
- One write produces one round.
- Empty findings clear gate.
- Observations never affect gate.
- `gate_cleared` cannot be reviewer-supplied.
- `reviewed_revision` equals target revision at write time.
- Round cap fixture returns:

```json
{
  "status": "blocked",
  "stage": null,
  "reason": "max_rounds_reached"
}
```

- Gate command returns stable JSON and does not write.

### Dependencies
- P-09.

### Gated item
- Recovery from `blocked` due to round cap is gated on ISSUE A.
