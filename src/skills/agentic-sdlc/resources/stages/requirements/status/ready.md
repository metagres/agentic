All gates passed. 
Session handoff: if you were invoked by a coordinator, this is the only
content that leaves this session. Return exactly:

  status: complete
  artifact_ref: <artifact id/path>
  requirements_count: <N>
  acceptance_criteria_count: <M>
  deltas_count: <K>
  clarity: <clear|partial|vague>
  out_of_scope: <true|false>

Nothing else. Discovery answers (DL-NNN), assumptions, requirement
drafts, and interview detail stay in the artifact store, addressable via
artifact_ref. The coordinator reads them from the store if it ever needs
the detail — not from this session.