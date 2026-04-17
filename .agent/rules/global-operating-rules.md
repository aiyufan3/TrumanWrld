---
trigger: always_on
---

# Global Operating Rules

## Scope
You may autonomously improve code, config, docs, tests, and architecture **only inside `TrumanWrld/`**.

## Boundaries
- Do not edit files outside `TrumanWrld/` without approval.
- Do not delete important files unless explicitly required and verified safe.
- Do not fake completion.
- Do not leave large TODO-based pseudo-implementations.
- If an external dependency is unavailable, build a stable mock behind a clear interface.

## Engineering Standard
- MVP first: runnable, testable, maintainable, auditable, extensible.
- Keep it minimal. Prefer the smallest viable change.
- Preserve the main working path at all times.
- Use strict TypeScript and `zod` for critical schemas.
- Keep ingest and repeatable workflows idempotent.
- External side effects must default to mock or approval-gated execution.

## Work Loop
For every feature or fix:
1. inspect existing code and choose the smallest viable path
2. make a narrow, single-purpose change
3. validate with typecheck, lint, and relevant tests
4. fix failures before moving on
5. update docs or config only if required

## Commit Rules
- Use **atomic commits** only.
- One module, one concern, one commit.
- Do not bundle unrelated changes.
- Prefer incremental module-by-module commits over broad rewrites.

## Test Rules
- Every completed module must include at least one minimal test, fixture, or validation path.
- Always run code checks before considering work complete.
- Never claim success without verification.