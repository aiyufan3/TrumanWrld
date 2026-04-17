# Skill: Minimax OpenAI-Compatible Provider

## Purpose
Use MiniMax as the default language model provider through a standardized OpenAI-compatible adapter, completely decoupling business logic from the specific LLM API implementation.

## When to Use
- Implementing Topic Ranking, Draft Generation, or Guardian risk assessment.
- Setting up the central LLM invocation framework in `src/adapters/model/`.

## Required Inputs
- Expected model behavior parameters (`systemPrompt`, `userPrompt`, `temperature`).
- Environment routing strings via `secrets/providers.example.json` logic (e.g., falling back onto `MODEL_PRIMARY` if specific model isn't requested).

## Expected Outputs
- A standardized `CompletionResponse` object containing the model text, token usage, and latency.

## Constraints
- Business logic (like `RankingService`) MUST NOT know that MiniMax is the underlying provider. It only knows an `ICompletionProvider` interface.
- Must read base URLs from `OPENAI_BASE_URL` (usually `https://api.minimaxi.com/v1`) and keys from `OPENAI_API_KEY`.
- Network errors must be caught and redacted so that `fetch` doesn't throw `API_KEY=xxx` into standard out.

## Step-by-Step Execution
1. Wrap an OpenAI REST client or generic `fetch` invocation targeting `OPENAI_BASE_URL/chat/completions`.
2. Map `model` argument to `process.env.MODEL_PRIMARY` (e.g., `MiniMax-M2.7`) or `process.env.MODEL_FAST`.
3. Execute request and normalize the response body to internal domains.
4. Handle rate-limiting (429) gracefully using exponential backoff without crashing the global autonomous pipeline.

## Validation Checklist
- [ ] Does the `minimaxProvider.ts` class implement `IModelProvider`?
- [ ] Is the business logic importing `IModelProvider` and ignoring provider-specific quirks?
- [ ] Are models dynamically selectable by env variables rather than hardcoded string literals?
