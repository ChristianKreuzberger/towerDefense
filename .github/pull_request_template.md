## Summary

<!-- What changed and why? -->

## Test plan

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:perf` (if simulation or performance-sensitive code changed)
- [ ] `npm run test:e2e` (if client/server flow changed)
- [ ] `npm run baseline:balance:verify:ci` (if simulation balance or baseline artifacts changed)

## CI notes

- Quality checks run on every pull request and `main` push.
- Balance drift checks upload artifacts when baseline metrics change.
- Tagged `v*` releases build artifacts and publish a GitHub release.
