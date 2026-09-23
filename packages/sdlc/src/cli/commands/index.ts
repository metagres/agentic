import type { CliCommand } from '../protocol.ts';
import { helpCommand } from './help.ts';
import { versionCommand } from './version.ts';

// Registry-only module: owns dispatch order (first match wins). Import
// builders, descriptors, and command objects from their defining modules,
// never through here.
export const commands: readonly CliCommand[] = [versionCommand, helpCommand];
