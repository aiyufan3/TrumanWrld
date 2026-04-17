# Skill: Publisher Adapter

## Purpose
An external boundary bridge that communicates over network to Platforms like X or Threads.

## When to Use
- Solely invoked by an `approved` state draft entering the Publish hook.

## Required Inputs
- Platform identity mapping string.
- Raw text array (if thread) or text string (if short post).

## Expected Outputs
- True/False success metrics and returned Platform Network metadata (Post IDs).

## Constraints
- MOCK FIRST. Do not enable real side effects without the manual ENV config bypassing safety checks.
- Handle rate limits via 429 backoff buffers.

## Validation Checklist
- [ ] Is `MockPublisherAdapter` default?
- [ ] Are keys sourced strictly from the `secrets.ts` loader?
