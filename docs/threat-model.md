# Threat Model

1. **Secret Exposure**
   - *Risk*: Pushing API tokens or DB passwords to GitHub.
   - *Mitigation*: Implementation of `.env.local` exclusion. Deep object redaction via `secrets.ts`. Runtime secret guards now block credential-like material from entering model prompts, publishing payloads, and unsafe ingestion paths.

2. **Accidental Social Publishing**
   - *Risk*: The agent generates hallucinated content and publishes without guardrails.
   - *Mitigation*: The `PUBLISH_MODE` defaults to `approval_only`. Real Publishing Adapters must explicitly await human CLI input or dashboard clicks.

3. **Investment Advice Hallucination**
   - *Risk*: Recommending financial products.
   - *Mitigation*: The Guardian module regex and LLM validations screen against typical "not financial advice" phrasing or concrete stock recommendations.

4. **Account Takeover / Session Theft**
   - *Risk*: Browser cookies, access tokens, password reset links, OTP codes, or storage-state exports are exposed to models, logs, screenshots, or third-party endpoints.
   - *Mitigation*: `security-rules.md` now forbids these flows by default, strict security environment flags ship enabled, and the runtime secret guard blocks credential-like material before model calls or publishing actions.
