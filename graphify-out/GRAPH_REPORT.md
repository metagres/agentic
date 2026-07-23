# Graph Report - agentic  (2026-10-03)

## Corpus Check
- 86 files · ~74,639 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .template 1)

## Summary
- 639 nodes · 1335 edges · 21 communities (19 shown, 2 thin omitted)
- Extraction: 96% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.87)
- Token cost: 122,676 input · 20,446 output

## Community Hubs (Navigation)
- CLI Entry & Command Registration
- Stage Registry & Project Resolution
- Stage Definitions & Artifact Types
- Artifact Type Registry Validation
- Review & Deploy Governance
- Package Dependencies & Document Parsing
- Agent Roles: Clarify & Implement
- Deploy Bundler & Agent Generation
- Document Machinery
- Knowledge Bundle & Specification
- Context Generator Ignore Engine
- Config & Work-Item Test Fixtures
- Stage & Workflow Definitions Loader
- TypeScript Compiler Config
- Install Config & Policy Resolution
- Intake & Settings Documents
- Workflows Command Tests
- Stages Command Tests
- CLI Entrypoint Tests
- OKF Command Surface
- Headroom Service Setup Notes

## God Nodes (most connected - your core abstractions)
1. `planning Agent (Steps 1-4: Check Repo, Scope and Classify, Investigate, Phased Plan)` - 18 edges
2. `CommandDefinition` - 17 edges
3. `compilerOptions` - 15 edges
4. `zod` - 14 edges
5. `CommandError` - 14 edges
6. `initiateWorkItem()` - 14 edges
7. `notImplemented()` - 13 edges
8. `implementation Agent (Implement One Phase of an Approved Plan, Verify, Review, Commit After Approval)` - 13 edges
9. `stages.ts Stage Registry` - 12 edges
10. `defineDocument()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Seven-Point Review Checklist` --semantically_similar_to--> `Eight Acceptance Checks Observable from the Deployed Tree`  [INFERRED] [semantically similar]
  assets/agents/review.md → scripts/DEPLOY.md
- `Blocking vs Advice Rule` --semantically_similar_to--> `Governing-Document Edits This Decision Requires`  [INFERRED] [semantically similar]
  assets/agents/review.md → scripts/DEPLOY.md
- `Actor Convention (human:<id>, <producer>/<version>, process:<id>)` --implements--> `.agents/knowledge as an OKF v0.2 Bundle`  [INFERRED]
  assets/agents/curator.md → .agents/knowledge/okf-usage.md
- `Source-to-Deploy Mapping Table` --references--> `Requirements Stage Definition`  [EXTRACTED]
  scripts/README.md → src/assets/stages/requirements.md
- `CLI Bundling Not Yet Implemented` --conceptually_related_to--> `Zero-Dependency Single ESM Bundle (tools/sdlc/sdlc.mjs)`  [INFERRED]
  src/cli/README.md → scripts/DEPLOY.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Default SDLC Stage Pipeline** — src_assets_workflows_yaml_default_workflow, src_assets_stages_requirements_md_requirements_stage, src_assets_stages_design_md_design_stage, src_assets_stages_implementation_md_implementation_stage, src_assets_stages_review_md_review_stage, src_assets_stages_archive_md_archive_stage [EXTRACTED 1.00]
- **CLI Command Contract Stack** — src_cli_readme_md_sdlc_cli, src_cli_readme_md_command_definition, src_cli_readme_md_shared_options, src_cli_readme_md_assertvalidinvocation, src_cli_readme_md_payloadfor, src_cli_readme_md_output_contract, src_cli_readme_md_exit_codes [EXTRACTED 1.00]
- **Work-Item Creation Durability Guarantees** — src_work_items_readme_md_initiate, src_work_items_readme_md_utility, src_work_items_readme_md_atomic_creation, src_work_items_readme_md_no_clobber, src_work_items_readme_md_stale_staging_sweep, src_work_items_readme_md_per_file_replace [EXTRACTED 1.00]
- **Knowledge-Base-First Agent Workflow (AGENTS.md defines affected parts, contracts, verification commands, and conventions)** — assets_agents_clarification, assets_agents_planning, assets_agents_investigate, assets_agents_implementation, assets_agents_planning_affected_parts, assets_agents_planning_contract_change_declaration, assets_agents_implementation_baseline_verification, assets_agents_implementation_commit_approval_gate [INFERRED 0.85]
- **Brief-to-Build Lifecycle (clarification brief, investigation, phased plan, one-phase implementation, review, approved commit)** — assets_agents_clarification_confirmed_brief, assets_agents_planning_brief_precondition, assets_agents_investigate_report_format, assets_agents_planning_phased_plan, assets_agents_implementation_plan_precondition, assets_agents_implementation_review_gate, assets_agents_implementation_commit_approval_gate [INFERRED 0.85]
- **Never Assume, Never Invent: Explicit Uncertainty Surfacing Instead of Silent Guessing** — assets_agents_clarification_batched_questioning, assets_agents_planning_evidence_check, assets_agents_investigate_path_symbol_evidence, assets_agents_investigate_missing_input_disclosure, assets_agents_implementation_no_silent_deviation [INFERRED 0.85]
- **Deploy File Classes: ownership decides Generated vs Configuration** — scripts_deploy_md_file_classes, scripts_deploy_md_generated_class, scripts_deploy_md_configuration_class, scripts_deploy_md_opencode_jsonc_never_written [EXTRACTED 1.00]
- **Zero-Dependency Bundle Integrity Chain** — scripts_deploy_md_sdlc_mjs_bundle, scripts_deploy_md_load_bearing_bundler_settings, scripts_deploy_md_import_meta_url_walkup, scripts_deploy_md_opencode_plugin, scripts_deploy_md_acceptance_checks [INFERRED 0.85]
- **Review Report Vocabulary: verdict, findings severity, not-checked** — assets_agents_review_review_report_format, assets_agents_review_blocking_vs_advice_rule, assets_agents_review_review_checklist [EXTRACTED 1.00]

## Communities (21 total, 2 thin omitted)

### Community 0 - "CLI Entry & Command Registration"
Cohesion: 0.06
Nodes (58): argumentsOf(), longFlag(), attachStdinValues(), createCli(), fail(), GLOBAL_OPTIONS, helpPayload(), main() (+50 more)

### Community 1 - "Stage Registry & Project Resolution"
Cohesion: 0.05
Nodes (45): resolveWorkItemsRoot(), getActiveProjectDir(), setActiveProjectDir(), StageSequenceIssue, StageSequenceIssueCode, validateStageSequence(), isMarkdownFile(), loadStageRegistry() (+37 more)

### Community 2 - "Stage Definitions & Artifact Types"
Cohesion: 0.06
Nodes (47): implements Relation (task to requirement), Plan Task Artifact Type, Requirement Artifact Type, Install Configuration (config.yaml), Runtime Policy Block (gate_attempt_cap, open_issue_cap), Archive Stage Definition (terminal), Design Stage Definition, Implementation Stage Definition (+39 more)

### Community 3 - "Artifact Type Registry Validation"
Cohesion: 0.05
Nodes (56): ARTIFACT_TYPE_ID_REGEX, ArtifactTypeDefinition, ArtifactTypeDefinitionSchema, ArtifactTypeDocument, ArtifactTypeField, ArtifactTypeFieldSchema, ArtifactTypeRegistry, ArtifactTypeRelation (+48 more)

### Community 4 - "Review & Deploy Governance"
Cohesion: 0.07
Nodes (28): Binding Documents (code-principles, convention, architecture, decision), Change Inspection via git status / git diff, Knowledge-Base Procedure (AGENTS.md), Frontmatter Permission Allow-List (edit/webfetch/bash denied), Review Agent (review.md), Review Report Format (verdict / findings / not checked), Eight Acceptance Checks Observable from the Deployed Tree, CLI Assets Source Tree (src/assets/) (+20 more)

### Community 5 - "Package Dependencies & Document Parsing"
Cohesion: 0.05
Nodes (40): dependencies, cac, gray-matter, yaml, zod, description, devDependencies, tsup (+32 more)

### Community 6 - "Agent Roles: Clarify & Implement"
Cohesion: 0.09
Nodes (21): clarification Agent (Step 0: Request to Confirmed Brief), Ambiguity Inventory (unclear terms, missing inputs/outputs, error and edge cases, permissions, affected users and parts, constraints), Confirmed Brief (request, acceptance criteria, non-goals, constraints, decisions, open questions: none), implementation Agent (Implement One Phase of an Approved Plan, Verify, Review, Commit After Approval), Prepare Gate (clean tree, branch <type>/<short-name> with permission, AGENTS.md verification commands green) before the first change, Commit Approval Gate (report, propose a conventional commit message, wait for approval, stage only phase files, never push), An Approved Plan Must Be in the Conversation; Otherwise Stop and Do Not Improvise One, Review Subagent Gate (plan summary, acceptance criteria, touched parts; fix blocking findings, two blocking rounds then stop) (+13 more)

### Community 7 - "Deploy Bundler & Agent Generation"
Cohesion: 0.13
Nodes (26): AGENT_KEYS, bindingOf(), bodyOf(), bundle(), CLI_ASSETS, CLI_ENTRY, commandToken(), DeployError (+18 more)

### Community 8 - "Document Machinery"
Cohesion: 0.14
Nodes (20): asRecord(), CreatableDocument, CreatableFields, defineCreatableDocument(), defineDocument(), Document, DocumentRecord, DocumentSpec (+12 more)

### Community 9 - "Knowledge Bundle & Specification"
Cohesion: 0.11
Nodes (16): Knowledge Bundle Index (specification, conventions, decisions, reference), Artifact Type Definitions (unit of definition for structure, relations, validation, evaluation), Lifecycle Record Design (non-normative, conflicts with spec on purpose), Normative Specification Section (§0 Clarify → §7 Report & commit), OKF Usage in This Repository, .agents/knowledge as an OKF v0.2 Bundle, Work-item Files Are OKF-Compatible, Not Conformant, OKF v0.2 Specification (GoogleCloudPlatform/knowledge-catalog) (+8 more)

### Community 10 - "Context Generator Ignore Engine"
Cohesion: 0.14
Nodes (14): ALWAYS_SKIP_DIRS, ALWAYS_SKIP_FILES, BINARY_EXTENSIONS, compileRule(), controlRatio(), decodeText(), DEFAULT_IGNORE_PATTERNS, formatBytes() (+6 more)

### Community 11 - "Config & Work-Item Test Fixtures"
Cohesion: 0.15
Nodes (7): dirs, REPO_ASSETS, dirs, REPO_ASSETS, dirs, dirs, fields

### Community 12 - "Stage & Workflow Definitions Loader"
Cohesion: 0.17
Nodes (13): RegisteredStage, STAGE_ID_REGEX, StageDefinition, StageDefinitionSchema, StageDocument, WORKFLOW_ID_REGEX, WorkflowDefinition, WorkflowDefinitions (+5 more)

### Community 13 - "TypeScript Compiler Config"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, module, moduleResolution, noEmit, noFallthroughCasesInSwitch, noImplicitOverride, noUncheckedIndexedAccess (+8 more)

### Community 14 - "Install Config & Policy Resolution"
Cohesion: 0.18
Nodes (11): DEFAULT_INSTALL_CONFIG, DEFAULT_POLICY, InstallConfig, InstallConfigFileSchema, loadInstallConfig(), Policy, PolicyOverrides, PolicySchema (+3 more)

### Community 15 - "Intake & Settings Documents"
Cohesion: 0.17
Nodes (9): zod, IntakeDocument, SCHEMA, dirs, Note, NoteSchema, Settings, SettingsSchema (+1 more)

### Community 16 - "Workflows Command Tests"
Cohesion: 0.17
Nodes (8): loadWorkflowDefinitions(), CLI, CliResult, dirs, FIXTURE_WORKFLOWS, FixtureWorkflow, ListedWorkflow, REPO_ASSETS

### Community 17 - "Stages Command Tests"
Cohesion: 0.18
Nodes (9): CLI, CliResult, dirs, FIXTURE_STAGES, FixtureStage, ListedStage, makeFixtureAssets(), REPO_ASSETS (+1 more)

### Community 18 - "CLI Entrypoint Tests"
Cohesion: 0.24
Nodes (7): CLI, CliResult, CollectedResult, dirs, fails(), ok(), runCli()

## Ambiguous Edges - Review These
- `clarification Agent (Step 0: Request to Confirmed Brief)` → `Instruction Aliases `plan`, `clarify`, and `build` Do Not Match the Agent File Names (planning.md, clarification.md, implementation.md)`  [AMBIGUOUS]
  assets/agents/planning.md · relation: references
- `Instruction Aliases `plan`, `clarify`, and `build` Do Not Match the Agent File Names (planning.md, clarification.md, implementation.md)` → `implementation Agent (Implement One Phase of an Approved Plan, Verify, Review, Commit After Approval)`  [AMBIGUOUS]
  assets/agents/planning.md · relation: references

## Knowledge Gaps
- **167 isolated node(s):** `ALWAYS_SKIP_DIRS`, `ALWAYS_SKIP_FILES`, `DEFAULT_IGNORE_PATTERNS`, `BINARY_EXTENSIONS`, `name` (+162 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 231 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `clarification Agent (Step 0: Request to Confirmed Brief)` and `Instruction Aliases `plan`, `clarify`, and `build` Do Not Match the Agent File Names (planning.md, clarification.md, implementation.md)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Instruction Aliases `plan`, `clarify`, and `build` Do Not Match the Agent File Names (planning.md, clarification.md, implementation.md)` and `implementation Agent (Implement One Phase of an Approved Plan, Verify, Review, Commit After Approval)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `zod` connect `Intake & Settings Documents` to `Artifact Type Registry Validation`, `Package Dependencies & Document Parsing`, `Document Machinery`, `Stage & Workflow Definitions Loader`, `Install Config & Policy Resolution`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `Source-to-Deploy Mapping Table` connect `Review & Deploy Governance` to `Stage Definitions & Artifact Types`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `yaml` connect `Package Dependencies & Document Parsing` to `Document Machinery`, `Deploy Bundler & Agent Generation`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `planning Agent (Steps 1-4: Check Repo, Scope and Classify, Investigate, Phased Plan)` (e.g. with `An Approved Plan Must Be in the Conversation; Otherwise Stop and Do Not Improvise One` and `implementation Agent (Implement One Phase of an Approved Plan, Verify, Review, Commit After Approval)`) actually correct?**
  _`planning Agent (Steps 1-4: Check Repo, Scope and Classify, Investigate, Phased Plan)` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `ALWAYS_SKIP_DIRS`, `ALWAYS_SKIP_FILES`, `DEFAULT_IGNORE_PATTERNS` to the rest of the system?**
  _167 weakly-connected nodes found - possible documentation gaps or missing edges._