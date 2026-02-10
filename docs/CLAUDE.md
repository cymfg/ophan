# docs/

Project documentation and branding assets.

## Files

| File | Purpose |
|------|---------|
| `architecture.md` | System architecture with mermaid diagrams — two-loop paradigm, multi-agent framework, data flow, security model |
| `inner-loop.md` | Detailed inner loop documentation — initialization, evaluation, learning extraction, regeneration strategies, cost management |
| `outer-loop.md` | Detailed outer loop documentation — pattern detection, learning consolidation, proposal generation, digest, interactive review |
| `configuration.md` | Complete `.ophan.yaml` reference — all settings, defaults, validation, examples (minimal, high-quality, fast/cheap) |
| `*.png`, `*.svg` | Branding assets (logo, diagrams) |

## When to Update

- Update `architecture.md` when adding new agents or changing the agent framework
- Update `inner-loop.md` or `outer-loop.md` when modifying execution or review logic
- Update `configuration.md` when adding new config options to `OphanConfigSchema`
