# Skill: Content Research

## Purpose
Autonomously browse the web, RSS feeds, and designated intelligence sources to locate deep-insight articles on AI and macro capital logic.

## When to Use
- Scheduled background task intervals.
- When `TrumanWrld` signals depletion in the content queue.

## Required Inputs
- List of seed URLs or domain strings (e.g., hacker news, distinct substacks).

## Expected Outputs
- Raw text objects or Markdown strings ready to be sent to `IngestionService`.

## Constraints
- Do not scrape aggressively; observe standard timeout etiquette.
- Maintain mock-first interfaces if the API to gather data isn't configured.

## Validation Checklist
- [ ] Has source bias been evaluated?
- [ ] Is the data passed along properly deduplicated?
