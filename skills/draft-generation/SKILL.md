# Skill: Draft Generation

## Purpose
Convert high-ranking signals into deployable platform blueprints (e.g., X short, X thread, Threads soft format).

## When to Use
- Triggered for any `TopicScore` exceeding the internal threshold (e.g., >70).

## Required Inputs
- `TopicScore` content and contextual `Signal` reference.

## Expected Outputs
- A `ContentDraft` array with multiple versions formatted cleanly.

## Constraints
- Ensure tone guidelines are injected into the Prompt Builder.
- Never output the prompt context in the actual drafted post.

## Validation Checklist
- [ ] Are versions segregated strictly by platform string?
- [ ] Is formatting optimal (e.g., thread counts mapped like [1/5])?
