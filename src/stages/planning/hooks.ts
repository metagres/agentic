// Optional hooks module for the planning stage: supplies the advisory
// precondition warnings about the design and requirements artifact statuses.
import path from 'node:path';

interface HookEnv {
  [key: string]: unknown;
}

export default {
  getExtraData(env: HookEnv) {
    const artifact = (env.artifact || {}) as Record<string, unknown>;
    const metadata = (artifact.metadata || {}) as Record<string, unknown>;
    return {
      based_on_design: (metadata.based_on_design as string) || null,
      based_on_requirements: (metadata.based_on_requirements as string) || null,
    };
  },

  preconditionWarnings(env: HookEnv) {
    const warnings: { code: string; message: string }[] = [];
    if (!env.changeRoot) return warnings;

    const readYaml = env.readYaml as ((file: string) => unknown) | undefined;

    const design = readYaml
      ? (readYaml(path.join(String(env.changeRoot), 'design.yaml')) as
          | { metadata?: Record<string, unknown> }
          | null)
      : null;

    if (design) {
      const metadata = design.metadata || {};
      const status = String(metadata.status || '');

      if (!['ready-for-review', 'accepted'].includes(status)) {
        warnings.push({
          code: 'PREVIOUS_STAGE_NOT_READY',
          message:
            `design.yaml status is '${status || 'unknown'}'. ` +
            'Consider completing the design stage before finalizing planning.',
        });
      }
    }

    const requirements = readYaml
      ? (readYaml(path.join(String(env.changeRoot), 'requirements.yaml')) as
          | { metadata?: Record<string, unknown> }
          | null)
      : null;

    if (requirements) {
      const metadata = requirements.metadata || {};
      const status = String(metadata.status || '');

      if (!['ready-for-review', 'accepted'].includes(status)) {
        warnings.push({
          code: 'REQUIREMENTS_NOT_READY',
          message:
            `requirements.yaml status is '${status || 'unknown'}'. ` +
            'Consider completing requirements before finalizing planning.',
        });
      }
    }

    return warnings;
  },
};
