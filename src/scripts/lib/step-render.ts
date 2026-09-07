import path from 'node:path';

import type { StepDefinition } from './steps-loader.ts';

/**
 * Shared step-definition rendering (DM-003): one templating implementation and
 * one vars vocabulary for every kind interpreter. Step detection is
 * kind-specific interpretation policy; rendering a detected step is shared.
 */

/** Renders {{var}} placeholders; unknown placeholders stay literal. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return String(text || '').replace(/{{(\w+)}}/g, (_, key) =>
    vars[key] !== undefined ? vars[key] : `{{${key}}}`
  );
}

/** Resolves the CLI invocation string for the running bundle/script. */
export function cliInvocation(cwd: string): string {
  const scriptPath = path.resolve(process.argv[1] || '');
  if (!scriptPath) {
    return 'node src/scripts/sdlc.ts';
  }
  const rel = path.relative(cwd, scriptPath);
  return `node ${rel || scriptPath}`;
}

/**
 * The shared template vars contract: every kind's steps.yaml references the
 * same placeholders. Kind-specific extras (e.g. target) ride the extra map.
 */
export function buildStepVars(
  stageId: string,
  changeRoot: string | null,
  cwd: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    SDLC: cliInvocation(cwd),
    change_name: changeRoot ? path.basename(changeRoot) : '<change-name>',
    stage: stageId,
    ...extra,
  };
}

/**
 * Renders a step definition into the step_help surface (DEC-003): title,
 * templated markdown, templated commands, and exit criteria. Serves the
 * runtime step_help payload and the --describe-step definition alike.
 */
export function renderStepHelp(
  stepId: string,
  step: StepDefinition | undefined,
  vars: Record<string, string>
): {
  title: string;
  markdown: string;
  commands: string[];
  exit_criteria: string | null | Record<string, unknown>;
} {
  return {
    title: step?.title || stepId,
    markdown: renderTemplate(step?.markdown || '', vars),
    commands: (step?.commands || []).map((command) => renderTemplate(command, vars)),
    exit_criteria: step?.exit_criteria || null,
  };
}
