# src/templates/

Default project initialization templates used by `ophan init`.

## Structure

```
templates/
└── fallback/
    └── base/    # Default template when no project-type-specific template matches
```

## How Templates Work

The `init` command in `src/cli/commands/init.ts` detects the project type (Node.js, TypeScript, Python, Go, etc.) and selects an appropriate template. If no specific template exists, the fallback/base template is used.

Templates provide default content for:
- Guidelines (`coding.md`, `testing.md`, `planning.md`, `context.md`, `learnings.md`, `orchestration.md`, `communication.md`)
- Criteria (`quality.md`, `security.md`, `context-quality.md`, `orchestration-quality.md`)
- Initial `.ophan.yaml` configuration

Currently, most template content is generated inline in `init.ts` based on detected project features rather than read from template files.
