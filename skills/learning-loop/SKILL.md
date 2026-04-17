# Skill: Learning Loop

## Purpose
A Hermes-style memory writeback pattern that improves TrumanWrld's accuracy iteration over time.

## When to Use
- Executed on a lag, correlating analytics success to specific draft structures.

## Required Inputs
- Historical Draft Object + Analytics Metric Results.

## Expected Outputs
- Extracted stylistic memory markers written to `data/memory`.

## Constraints
- Ensure memory files are local `*.md` or `*.json`. Do not upload this IP unless explicitly requested.

## Validation Checklist
- [ ] Does `learnFromOutcomes()` successfully append to the internal prompt context?
