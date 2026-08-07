import { loadPipeline } from './policy-loader.ts';

export interface StageConfig {
  artifact?: string;
  schema?: string;
  template?: string;
  review_file?: string;
  status_field?: string;
  review_target?: string;
  delta_phase?: string;
  requires?: string[];
  produces_delta?: boolean;
  output?: string;
  source_artifacts?: string[];
}

export interface ReviewTargetConfig {
  artifact: string;
  review_file: string;
  status_field: string;
}

function loadStages(cwd: string): Record<string, StageConfig> {
  const doc = loadPipeline(cwd) as { stages?: Record<string, StageConfig> } | null;
  if (!doc || typeof doc.stages !== 'object' || doc.stages === null) {
    throw new Error('pipeline.yaml must define stages');
  }
  return doc.stages;
}

export function getStage(cwd: string, stageId: string): StageConfig | null {
  const stages = loadStages(cwd);
  return stages[stageId] || null;
}

export function getReviewTargets(cwd: string): Record<string, ReviewTargetConfig> {
  const stages = loadStages(cwd);
  const targets: Record<string, ReviewTargetConfig> = {};

  for (const [stageId, stage] of Object.entries(stages)) {
    if (!stage.review_file) continue;
    const key = stage.review_target || stageId;
    targets[key] = {
      artifact: stage.artifact as string,
      review_file: stage.review_file,
      status_field: stage.status_field as string,
    };
  }

  return targets;
}

export function getReviewTarget(cwd: string, targetId: string): ReviewTargetConfig | null {
  return getReviewTargets(cwd)[targetId] || null;
}

export function getPipelineOrder(cwd: string): string[] {
  return Object.keys(loadStages(cwd));
}

export function getStagesWithDelta(cwd: string): { stage: string; artifact: string; file: string }[] {
  const stages = loadStages(cwd);
  const out: { stage: string; artifact: string; file: string }[] = [];

  for (const [stageId, stage] of Object.entries(stages)) {
    if (stage.produces_delta && stage.artifact) {
      out.push({ stage: stageId, artifact: stage.artifact, file: stage.artifact });
    }
  }

  return out;
}

export function getSchemaForTarget(cwd: string, target: string): string | null {
  const stages = loadStages(cwd);

  for (const [stageId, stage] of Object.entries(stages)) {
    if (stage.review_target === target || stageId === target) {
      return stage.schema || null;
    }
  }

  return null;
}

export function getArtifactForStage(cwd: string, stageId: string): string | null {
  const stage = getStage(cwd, stageId);
  return stage?.artifact || null;
}