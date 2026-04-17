# TrumanWrld Architecture

## Overview
TrumanWrld is an autonomous local-first agent system for operating a personal brand. It utilizes a modular monolithic architecture written in TypeScript. 

## Key Modules
1. **Ingestion**: Standardizes external signals.
2. **Ranking**: Uses an LLM to score signals based on novelty and persona relevance.
3. **Drafting**: Converts high-scoring signals into multi-platform drafts.
4. **Guardian**: Filters hallucinated or problematic tones.
5. **Approval**: Local state machine acting as a human barrier.
6. **Publishing**: Adapters mapped to X and Threads functionalities.
7. **Analytics**: Logs performance placeholders.
8. **Learning**: Reads post-performance and updates future retrieval memory.

## Providers
- MiniMax operates as the core reasoning loop wrapped by a standard OpenAI-compatible mock provider. 
- State is now externalized into a Harness runtime workspace under `runtime/harness/runs/<runId>/`.

## Harness Runtime
The application now runs through an explicit `Planner -> Generator -> Evaluator` harness:

1. **Ingestion** locks the incoming signal into `artifacts/signal.json`.
2. **Planner** writes `artifacts/plan.json`, defining acceptance criteria and context pointers.
3. **Generator** performs ranking and drafting while consuming only the distilled planner brief.
4. **Evaluator** runs Guardian plus deterministic checks and can force draft retries.
5. **Approval** blocks publishing until a human resumes the run with explicit approval.
6. **Publishing / Analytics / Learning** execute only after approval and each write their own artifacts.

## Auth Boundary
- A dedicated local control console exposes `Connect X` and `Connect Threads` buttons for human-initiated account linking plus a local approval queue for paused runs.
- Login, 2FA, and consent happen only on official provider pages.
- OAuth callbacks land on the local backend, which exchanges the authorization code for tokens and stores them in an encrypted local token store.
- The approval console resumes paused runs from the same runtime workspace, so publishing remains explicitly human-gated without forcing CLI-only operations.
- The agent only talks to publisher adapters backed by encrypted tokens; it never receives raw passwords, 2FA codes, cookies, or browser sessions.

## Publish Reliability
- Real publisher adapters now retry transient provider failures such as rate limits, upstream 5xx responses, and refreshable auth failures.
- Publish receipts record attempt counts plus provider URLs when available, which keeps the audit trail legible after a real post goes out.

## Recoverability
- `progress.json`: step-by-step state ledger for the current run.
- `events.ndjson`: append-only audit trail for debugging and postmortems.
- `artifacts/*.json`: typed outputs that let a later agent or operator resume from a clean breakpoint.

## Context Strategy
- `agent.md` is the root directory file for navigation.
- Detailed prompts remain in `prompts/system/`.
- Generator and evaluator are context-isolated so failures, retries, and summaries do not pollute the main orchestration state.
