# System Security Rules

## 1. Secrets Handling
- NEVER print secrets in console logs.
- NEVER echo tokens, passwords, or cookies in any errors or output.
- NEVER write real credentials into the codebase repository.
- NEVER submit `.env.local`, `secrets.json`, browser cookies, SSH keys, or OS keychain contents to git.
- NEVER leak sensitive data in `README`, prompt definitions, test fixtures, or screenshot artifacts.
- NEVER place secrets in model prompts, approval requests, analytics payloads, publishing payloads, screenshots, or URLs.
- NEVER paste recovery codes, 2FA codes, password reset links, session cookies, browser storage exports, or `playwright-storage-state.json` contents into any agent-facing context.

## 2. Using Credentials
- Use only environment variable references (e.g., `process.env.OPENAI_API_KEY`).
- Rely strictly on `.example` template files for new external integrations.
- Always use the `secrets.ts` redaction helpers before emitting external metrics or logs.
- Route all model-facing and network-facing text through the runtime secret guard before transmission.
- Treat account login state, browser sessions, and OAuth callbacks as high-risk secrets even when they are not named "token" or "password".

## 3. High Risk Operations Guardrails
You MUST enter the approval queue and seek explicit Human-in-the-Loop permission before:
- Invoking REAL social media publishing APIs.
- Modifying OS-level settings or installing global packages outside the workspace.
- Touching password managers, keychain data, or browser profiles.
- Any network operations targeting private intranet endpoints.
- Any browser automation that signs into X, Threads, email, 2FA, or password reset flows.
- Any operation that reads, writes, uploads, or transforms cookies, storage-state files, OTP seeds, or recovery codes.

## 4. Account Safety Defaults
- Password-based automation is disabled by default.
- Browser login automation is disabled by default.
- If a task would require exposing credentials to an LLM, network request body, or third-party page, stop and require a safer alternative.
