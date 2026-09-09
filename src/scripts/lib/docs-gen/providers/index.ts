/**
 * docs-gen provider registry: every provider this toolkit ships, keyed by
 * the ids the manifest references. Adding a provider is a new module plus
 * one registry entry plus a manifest entry — zero engine change.
 */

import { dependenciesProvider } from './dependencies.ts';
import { knownIssuesProvider } from './known-issues.ts';
import { decisionsProvider } from './decisions.ts';
import { indexProvider } from './index-crosscheck.ts';
import {
  operationsCommandsProvider,
  operationsTestingProvider,
  operationsEnvironmentProvider,
  operationsDeploymentProvider,
} from './operations.ts';
import { glossaryFieldsProvider } from './glossary.ts';
import {
  architectureTechStackProvider,
  architectureImportGraphProvider,
} from './architecture.ts';
import {
  apiContractEnvelopeProvider,
  apiContractSchemaReconciliationProvider,
  apiContractErrorCatalogProvider,
} from './api-contract.ts';
import { conventionsChecksReferenceProvider } from './conventions.ts';
import type { Provider } from '../types.ts';

export const providerRegistry: Map<string, Provider> = new Map<string, Provider>(
  (
    [
      ['dependencies', dependenciesProvider],
      ['known-issues', knownIssuesProvider],
      ['decisions', decisionsProvider],
      ['index', indexProvider],
      ['operations-commands', operationsCommandsProvider],
      ['operations-testing', operationsTestingProvider],
      ['operations-environment', operationsEnvironmentProvider],
      ['operations-deployment', operationsDeploymentProvider],
      ['glossary-fields', glossaryFieldsProvider('glossary-fields')],
      ['architecture-tech-stack', architectureTechStackProvider],
      ['architecture-import-graph', architectureImportGraphProvider],
      ['api-contract-envelope', apiContractEnvelopeProvider],
      ['api-contract-schema-reconciliation', apiContractSchemaReconciliationProvider],
      ['api-contract-error-catalog', apiContractErrorCatalogProvider],
      ['conventions-checks-reference', conventionsChecksReferenceProvider],
    ] as [string, Provider][]
  )
);
