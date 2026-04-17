# System Security Rules

## 1. Secrets Handling
- NEVER print secrets in console logs.
- NEVER echo tokens, passwords, or cookies in any errors or output.
- NEVER write real credentials into the codebase repository.
- NEVER submit `.env.local`, `secrets.json`, browser cookies, SSH keys, or OS keychain contents to git.
- NEVER leak sensitive data in `README`, prompt definitions, test fixtures, or screenshot artifacts.

## 2. Using Credentials
- Use only environment variable references (e.g., `process.env.OPENAI_API_KEY`).
- Rely strictly on `.example` template files for new external integrations.
- Always use the `secrets.ts` redaction helpers before emitting external metrics or logs. 

## 3. High Risk Operations Guardrails
You MUST enter the approval queue and seek explicit Human-in-the-Loop permission before:
- Invoking REAL social media publishing APIs.
- Modifying OS-level settings or installing global packages outside the workspace.
- Touching password managers, keychain data, or browser profiles.
- Any network operations targeting private intranet endpoints.
