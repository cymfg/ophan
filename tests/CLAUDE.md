# tests/

Vitest unit tests for Ophan.

## Structure

```
tests/
└── unit/
    ├── config.test.ts              # Config loading, validation, env var interpolation
    ├── evaluation.test.ts          # Evaluation regex patterns, scoring
    ├── learning-manager.test.ts    # Deduplication, promotion, retention
    ├── pattern-detector.test.ts    # Pattern detection from logs
    ├── tool-runner.test.ts         # Tool execution, guardrails
    ├── claude-code-executor.test.ts # Executor initialization, streaming
    ├── webhook.test.ts             # Webhook client, event filtering
    ├── prompts.test.ts             # Prompt building, template assembly
    └── ui-server.test.ts           # Express server, API endpoints
```

## Running Tests

```bash
npm test               # Run all tests (watch mode)
npm run test:coverage  # Run with v8 coverage report
```

## Conventions

- Vitest globals enabled — `describe`, `it`, `expect` available without import
- Pattern: Arrange → Act → Assert
- Tests must be deterministic — no external service dependencies
- Mock file I/O and Claude SDK calls
- Test files mirror source structure: `tests/unit/<module>.test.ts`
- When adding new source modules, add corresponding test file here
