# Skill: Approval Workflow

## Purpose
Manage state machine transitions locally (CLI / DB map) to prevent unwanted automated actions.

## When to Use
- State mutation from `draft` -> `approved` -> `published`.

## Required Inputs
- State Mutation Event (e.g., Human clicking "Approve" via CLI/Bot).

## Expected Outputs
- Mutated state representation and trigger of next pipeline handler.

## Constraints
- Immutable record logs. Keep prior versions if `needs_revision` is invoked.

## Validation Checklist
- [ ] Does state transition prevent a Draft going straight to Publish?
