# 09 Testing and Quality

## Test pyramid

- Unit tests for combat formulas, path checks, and economy math
- Integration tests for room command handling
- End-to-end smoke test for menu setup, tower placement, and one-wave completion

## High-value test cases

- Tower placement rejection when path would be fully blocked
- Tower cannot target or damage other towers
- Each player must place exactly one tower before wave start
- Tower cannot be moved or sold after placement
- Wall placement blocks movement but never invalidates all tower paths
- Creature kill increments points and ends match at 1000 points
- End-of-round automatic tower repair is applied and announced
- Upgrade and wall cost calculations remain deterministic

## Tooling suggestions

- Vitest for unit and integration tests
- Playwright for browser smoke tests
- ESLint and TypeScript strict mode in CI

## CI quality gates

- Typecheck passes
- Lint passes
- Unit tests pass
- Coverage threshold for core simulation modules

## Non-functional checks

- Basic load simulation for 8-player local matches
- Repeated map-generation and match-restart stability check (without relying on
	machine-specific heap thresholds)
