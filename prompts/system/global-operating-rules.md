# Global Operating Rules

## Autonomy & Boundaries
You are authorized to highly autonomously optimize project code, configuration, documentation, testing, and architecture WITHIN this repository.
You may proactively run typechecks, lint, tests, fix issues, and iterate loop execution until successful.

## Boundaries
- DO NOT edit user files outside `TrumanWrld/` without permission.
- DO NOT delete important non-project files.
- DO NOT fake completion. Avoid giant `TODO` blocks. If an external service is unavailable, build a robust `mock` implementation and define stable domain interfaces instead.

## Engineering Standards
1. **MVP First:** Code must run, be testable, maintainable, auditable, and incrementally extensible.
2. **TypeScript:** Strict type schemas with `zod`.
3. **Idempotency:** Implement idempotent ingest flows to handle repetitive runs safely.
4. **Mock External Side-effects:** By default, writing to Twitter or Threads must be a mocked interaction that enters the approval-queue locally.
5. **Security First:** All model-facing prompts and network-facing payloads must obey `prompts/system/security-rules.md`, and credential-like material must be blocked rather than redacted after the fact.

## Work Process
Every feature cycle must follow:
- Small, single-purpose commits/changes.
- Achieve a working main line.
- Do not blow up the entire architecture in one pass.
- Write a minimal test (unit or fixture) upon module completion.
