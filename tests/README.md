# Validation harness

Vitest scaffold for `@honcho-ai/ai-sdk`. Test cases land in Task 5 (spine) and Task 6 (e2e), after Task 4.4 reconciles the spec field names against PR #2's actual exports.

## Layout

- `spine/` — mocked unit tests for middleware hooks (`transformParams`, `wrapGenerate`, `wrapStream`). Uses `fixtures/mock-honcho-sdk.ts`. Fast, deterministic, no network.
- `e2e/` — real-API integration tests gated on `HONCHO_API_KEY` + `HONCHO_WORKSPACE_ID`. Use `it.skipIf(!hasHonchoCredentials())`. Wrap test bodies in `withNetworkErrorSkip` so 5xx / rate-limit / connection failures show as `skip`, not `fail`.
- `fixtures/` — shared helpers: mock SDK shape, env guards, namespaced ID generator.

## Conventions

- Keep spine cases pure — no `process.env`, no real timers, no network.
- E2E cases must use `nanoidNamespace('peer')` / `nanoidNamespace('session')` so concurrent runs don't collide on shared workspace IDs.
- Gap-skipped tests (when added) use `it.todo('case name')` with a one-line `// gap: PR #2 doesn't implement X yet` comment so the missing surface is greppable.

## Running

- `bun run test` — vitest run (CI / pre-commit)
- `bun run test:watch` — vitest watch (dev loop)
- `bun run test:smoke` — Eri's `src/test.ts` smoke against real Honcho (preserved)
