# Skill: Source Ingestion

## Purpose
Normalize raw inputs (markdown, RSS, URLs) into standard `Signal` domain models.

## When to Use
- Whenever new research data hits the pipeline.

## Required Inputs
- Raw content string.
- Metadata (source attribution, timestamp).

## Expected Outputs
- A parsed `SignalSchema` representing the canonical entry in TrumanWrld.

## Constraints
- Ensure idempotency. Running the same URL twice must not duplicate the ID.

## Validation Checklist
- [ ] Is `SignalSchema` fully satisfied?
- [ ] Are dates properly handled via UTC standard?
