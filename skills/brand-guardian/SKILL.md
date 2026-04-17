# Skill: Brand Guardian

## Purpose
A deterministic and LLM-assisted defense layer that drops content violating brand safety logic before a human ever has to look at it.

## When to Use
- Automatically inserted between the `DraftingService` and `ApprovalQueue`.

## Required Inputs
- `ContentDraft`

## Expected Outputs
- Simple boolean `passed` mapping, and a `reason` if `false`.

## Constraints
- Do not let explicit financial advice slip through.
- Flag heavily unverified factual hallucination via `completeReasoning()` passes.

## Validation Checklist
- [ ] Is SEC compliance generally adhered to (no blatant shills of micro-caps)?
- [ ] Is the language purged of repetitive mechanical phrases?
