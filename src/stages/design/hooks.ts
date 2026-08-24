// Optional hooks module for the design stage: supplies the advisory
// precondition warnings about the requirements artifact status.
import path from 'node:path';

interface HookEnv {
  [key: string]: unknown;
}

export default {
  getExtraData(env: HookEnv) {
    const artifact = (env.artifact || {}) as Record<string, unknown>;
    const metadata = (artifact.metadata || {}) as Record<string, unknown>;
    return {
      based_on_requirements: (metadata.based_on_requirements as string) || null,
    };
  },

  preconditionWarnings(env: HookEnv) {
    const warnings: { code: string; message: string }[] = [];
    if (!env.changeRoot) return warnings;

    const readYaml = env.readYaml as ((file: string) => unknown) | undefined;
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
          code: 'PREVIOUS_STAGE_NOT_READY',
          message:
            `requirements.yaml status is '${status || 'unknown'}'. ` +
            'Consider completing the requirements stage before finalizing design.',
        });
      }
    }

    return warnings;
  },
};
