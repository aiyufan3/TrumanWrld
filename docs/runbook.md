# TrumanWrld Runbook

## Initialization
1. Clone the repository.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and add `OPENAI_API_KEY` mapping to MiniMax.
4. Update `secrets/providers.example.json` if alternate parameters are required.

## Execution
Run `npm run start` to create a new harness run locally. The system writes resumable state into `runtime/harness/runs/<runId>/` and defaults to mocked external side effects.

## OAuth Console
1. Generate a 32-byte base64 secret and place it in `OAUTH_TOKEN_ENCRYPTION_KEY`.
2. Configure your X and Threads app callback URLs to:
   - `http://127.0.0.1:8788/auth/x/callback`
   - `http://127.0.0.1:8788/auth/threads/callback`
3. Run `npm run auth:server`.
4. Open `http://127.0.0.1:8788/`. This local control console now handles both account linking and run approvals.
5. Click `Connect X` or `Connect Threads` when you want to authorize a provider.
6. Complete login, 2FA, and consent on the provider's official page only.
7. The callback stores provider tokens encrypted in `runtime/secure/oauth-tokens.enc`.

## Approval Console
1. Start a run with `npm run start`.
2. If the run reaches the approval barrier, open `http://127.0.0.1:8788/`.
3. Review the pending run card or open `/runs/<runId>` for full draft details and publish receipts.
4. Click `Approve & Resume` from the local console to continue the run without exposing passwords, cookies, or session state.
5. The control console records approval job status and keeps recent runs visible for audit.

## Validation
- Run `npm run validate` to execute the deterministic engineering checks for this codebase.
- The evaluator inside the app enforces content checks such as X length, platform coverage, and Guardian rejection rules.
- Keep `SECURITY_MODE=strict` and the `BLOCK_*_WITH_SECRETS` flags enabled unless you have a narrowly scoped local debugging reason not to.

## Troubleshooting
- **API Connectivity Issues**: Validate `OPENAI_BASE_URL`.
- **Secret Leaks**: Check `logger.ts` for disabled redaction flags.
- **Interrupted Runs**: Resume from the last persisted `runId`; the harness will reload completed artifacts instead of recomputing the whole flow.
- **Sensitive Input Blocked**: The runtime will now reject credential-like text before it reaches the model or publisher. Move secrets into environment variables or a local secure store instead of passing them through signals.
- **OAuth Callback Rejected**: Ensure the provider app's redirect URI exactly matches `AUTH_BASE_URL` plus the callback path.
- **Approval Page Looks Empty**: Confirm the run really stopped at `awaiting_approval` and that `HARNESS_RUNTIME_PATH` points to the same runtime folder as the control console.
