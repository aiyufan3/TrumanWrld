# Skill: Repository Hygiene & Architecture Integrity

## Purpose
Maintain clear module boundaries and prevent the repository from turning into a poorly structured "big ball of mud" over continued autonomous iteration.

## When to Use
- Whenever refactoring large files.
- Whenever completing a `src/modules/` implementation phase.
- Following every test suite execution.

## Step-by-Step Execution
1. **Check Zod Validations**: Make sure domain inputs/outputs define strict interfaces in `schemas/`. Do not pass raw JSON objects arbitrarily deep.
2. **Controller Glue**: Prevent putting thick business logic into routes or CLI endpoints (`src/app/`). `src/app/` should merely orchestrate the injection of dependencies.
3. **Dead Code Cleanup**: Remove temporary mock arrays when moving to a more formalized file-based or mock-DB structure.
4. **Docs Consistency**: Keep `README.md` and `docs/runbook.md` updated as CLI commands and dependencies install.

## Restrictions
- Avoid over-engineered abstractions. Do NOT build a plugin system unless explicitly necessary. Keep functions concise and procedural where appropriate, mapping data DTOs explicitly.
