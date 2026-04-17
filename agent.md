# TrumanWrld Agent Directory

This repository now runs through a recoverable Harness runtime instead of a single optimistic loop.

## Start Here
- Product intent: `docs/product-spec.md`
- Runtime architecture: `docs/architecture.md`
- Operating instructions: `docs/runbook.md`
- Safety and risk assumptions: `docs/threat-model.md`

## Execution Context
- Harness entrypoint: `src/app/index.ts`
- Harness runtime: `src/harness/`
- Local OAuth server: `src/server/`
- OAuth token backend: `src/auth/`
- Product modules: `src/modules/`
- Domain schemas: `src/schemas/models.ts`
- System prompts: `prompts/system/*.md`

## Recovery Model
- Each run writes to `runtime/harness/runs/<runId>/`
- `progress.json` is the resumable state ledger
- `artifacts/*.json` are the typed step outputs
- `events.ndjson` is the append-only audit trail

## Operating Rules
- Planner defines acceptance criteria before generation proceeds
- Generator only sees the planner digest, not the full raw repository context
- Evaluator is isolated from generation and can force retries
- Publishing is blocked until a human resumes the run with approval
- The local control console at `src/server/` is the preferred surface for account linking and approval actions
- Credential-like material, cookies, storage-state exports, passwords, and recovery codes must never enter model prompts or outbound payloads
- Account linking must happen through official OAuth pages, not password automation

## Resume Commands
- Start a run: `npm run start`
- Provide explicit approval: `npm run start -- --resume --run-id <id> --approve`
- Override input signal: `npm run start -- --signal "your signal here"`
