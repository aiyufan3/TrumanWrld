# Skill: Topic Ranking

## Purpose
Filter the signal noise by scoring standard inputs via LLM reasoning.

## When to Use
- Automatically executed when a new `Signal` is ingested.

## Required Inputs
- `Signal` object.

## Expected Outputs
- `TopicScore` object containing integer rankings 0-10.

## Constraints
- Must utilize `MinimaxProvider.completeFast`.
- Cannot output arbitrary strings. Must return strictly parsed JSON mapping to validation schema.

## Validation Checklist
- [ ] Is the `TopicScore` object validated against zod?
- [ ] If JSON parse fails, does it fallback robustly?
