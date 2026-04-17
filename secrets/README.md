# Secrets

Do not commit real secrets.

Use one of:
- `.env.local`
- OS keychain
- 1Password CLI
- Doppler / Vault / local secure store

Rules:
- commit only `*.example`
- never log raw secrets
- never use production credentials in tests
- never place cookies, tokens, SSH keys, or browser exports in git
