# Coding Standards

1. **Language**: Strict TypeScript with ES modules.
2. **Validation**: Use `zod` for all IO boundaries and schema parsing.
3. **Observability**: Use structured `pino` logging, ensuring `secrets.ts` wraps all objects to prevent key leaks.
4. **Architecture**: Clean module boundaries natively decoupled from external provider idiosyncrasies.
5. **Testing**: Mock-first integrations. Do not test against live X credentials. Use deterministic fixtures.
6. **Prohibited Patterns**:
   - Giant `TODO` blocks masking incomplete logic.
   - Naked hardcoded credentials or tokens.
   - Side-effects deeply nested inside irrelevant controllers.
