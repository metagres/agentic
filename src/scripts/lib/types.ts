export interface ParseArgsResult {
  _: string[];
  [key: string]: string | boolean | string[];
}

export interface WarningItem {
  code: string;
  message: string;
}

export interface ErrorItem {
  code: string;
  message: string;
  fix?: string;
  candidates?: string[];
}

export interface Finding {
  check: string;
  severity: string;
  category: string;
  target: string;
  finding: string;
  fix?: string;
}

export interface SemanticResult {
  check_id: string;
  status: string;
  evidence: string;
  evaluated_at: string;
}

export interface SemanticSummary {
  complete: boolean;
  missing: string[];
  failed: string[];
  results: SemanticResult[];
}

export interface StepDefinition {
  title?: string;
  next_action?: string;
  markdown?: string;
  commands?: string[];
  exit_criteria?: string | null | Record<string, unknown>;
}

export interface Ctx {
  loadFile: (relPath: string) => unknown;
  fileExists: (relPath: string) => boolean;
  readFile: (relPath: string) => string | null;
  changedFiles: () => string[];
}

export interface StageDef {
  id: string;
  artifactFile: string;
  deltaPhase: string;
  initialArtifact: (request: string, env: Record<string, unknown>) => Record<string, unknown>;
  nextIds?: (artifact: Record<string, unknown>) => Record<string, string>;
  preconditionWarnings?: (env: Record<string, unknown>) => WarningItem[];
  detectStep: (env: Record<string, unknown>) => string;
  recordAnswer?: (env: Record<string, unknown>) => void;
  setClarity?: (env: Record<string, unknown>) => void;
  getData?: (env: Record<string, unknown>) => Record<string, unknown>;
  isReadyForReview?: (env: Record<string, unknown>) => { ready: boolean; reasons: string[] };
}

export interface RunEnv {
  args: ParseArgsResult;
  cwd: string;
  changeRoot: string | null;
  artifactPath: string | null;
  artifact: Record<string, unknown> | null;
  ctx: Ctx;
  stage: StageDef;
  warnings: WarningItem[];
  findings?: Finding[];
  blocking?: Finding[];
  semantic?: SemanticSummary;
}

export interface WorkflowDef {
  id: string;
  description: string;
  run: (argv: string[]) => void;
}

export interface ChangeEntry {
  change_name: string;
  title: string;
  stage: string | null;
  status: string;
  version: string | null;
}
