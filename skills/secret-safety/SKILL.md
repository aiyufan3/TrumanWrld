# Skill: Secret Safety & Redaction

## Purpose
Ensure zero leakage of sensitive credentials, personally identifiable information, or local tokens when modifying the project, executing code, and generating logs.

## When to Use
- Whenever writing a new API integration (e.g., Minimax, X API, Threads).
- Whenever writing logging mechanisms (`pino` setup) or intercepting HTTP errors.
- Whenever creating test snapshots or fixture data.

## Required Inputs
- Payload data, error objects, or environment config maps.

## Expected Outputs
- A sanitized version of the input, where sensitive fields are replaced by `[REDACTED]`.

## Constraints
- **Strictly forbid** the writing of real secrets into the repository under any circumstance.
- Never blindly log full HTTP Axios/Fetch error objects, since they frequently contain `Authorization` headers.

## Step-by-Step Execution
1. Identify all fields categorized as secrets (e.g., ends with `_KEY`, `_SECRET`, `TOKEN`).
2. Pass the unredacted object to `src/utils/secrets.ts#redact()` before passing it into `logger.info()` or `logger.error()`.
3. If creating example configs, exclusively write `your_value_here` as placeholders in `.example` files.
4. Verify by attempting a dry-run log and observing the console output.

## Failure Modes
- A third-party library dumps the entire context on a crash. (Mitigation: use `uncaughtException` and `unhandledRejection` safe wrappers).
- A developer accidentally pastes a live token while using an interactive REPL.

## Validation Checklist
- [ ] Is `.env.local` inside `.gitignore`?
- [ ] Are test fixtures mocked out completely with fake keys (e.g., `sk-mock-...`)?
- [ ] Did you sanitize headers for any outgoing API diagnostic log?
