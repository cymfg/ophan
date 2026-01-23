# Changelog

All notable changes to Ophan will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2025-01-22

### Added
- **Context Agent**: Self-improving context compilation system that learns which files are relevant for tasks
  - Tracks context hit rate (% of provided files actually used) and miss rate (% of used files not provided)
  - Generates proposals to update context guidelines based on usage patterns
  - Target metrics: >70% hit rate, <20% miss rate
- **`ophan context-stats` command**: View context usage statistics and performance metrics
  - Shows average hit/miss rates across tasks
  - Identifies commonly needed but unprovided files
  - Identifies commonly provided but unused files
- **Interactive proposal review**: Enhanced `ophan review` with interactive CLI workflow
  - Approve, reject, edit, or skip proposals one by one
  - Group proposals by source (task-agent vs context-agent)
  - View proposal details with syntax highlighting
- New `ophan review` options:
  - `--auto`: Auto-approve guideline changes (criteria still require approval)
  - `--non-interactive`: Skip interactive review, save proposals to pending
  - `--pending`: Review pending proposals from previous runs
- Context guidelines template (`context.md`) added to `ophan init`
- Context quality criteria template (`context-quality.md`) added to `ophan init`
- Context usage logs stored in `.ophan/context-logs/` for analysis

### Changed
- **Claude Code Only**: Removed direct Anthropic API backend, now exclusively uses Claude Code (subscription-based)
  - Removed `@anthropic-ai/sdk` dependency
  - Removed `execution.backend` config option
  - Removed `model` config section
  - No API key required (uses Claude Code subscription)
- Proposal type now includes `source` field to distinguish task-agent vs context-agent proposals
- Proposal status now includes `skipped` state for deferred reviews
- Proposals track `humanFeedback`, `reviewedAt`, and `reviewedBy` fields
- Claude Code executor now tracks file usage for context evaluation
- Improved Claude Code executable discovery (prefers user's PATH over node_modules)
- Inner loop logs context usage metrics after each task

### Removed
- `src/llm/claude.ts` - ClaudeClient class (replaced by Claude Code executor)
- `execution.backend` config option (Claude Code is now the only backend)
- `model.name` and `model.maxTokens` config options (controlled by Claude Code)

## [0.4.1] - 2025-01-22

### Fixed
- Fixed inner loop marking tasks as "converged" even when criteria evaluation failed
  - Previously, if the agent signaled task completion, it would converge regardless of evaluation
  - Now tasks only converge when evaluation.passed is true
  - This ensures the agent must satisfy all criteria before task is considered successful

## [0.4.0] - 2025-01-22

### Fixed
- Fixed evaluation skipping custom criteria checks when tool outputs had errors
  - Previously, if tests showed any failure pattern, the LLM evaluation was skipped entirely
  - Now custom criteria (like product constraints in `criteria/product.md`) are always enforced
  - Critical fix for autonomous operation where criteria must be guardrails

## [0.3.3] - 2025-01-22

### Fixed
- Fixed UI task runner incorrectly requiring API key when using Claude Code backend
- Fixed Claude Code executor not finding the Claude Code executable path

## [0.3.2] - 2025-01-22

### Fixed
- Fixed UI static assets not found when installed globally via npm

## [0.3.0] - 2025-01-22

### Added
- Web UI for viewing status, logs, and editing configuration (`ophan ui`)
- Real-time task execution from the UI with WebSocket progress updates
- Dashboard with task metrics and success rates
- Configuration editor with form-based interface
- Guidelines and criteria viewer
- Digest browser for outer loop reports
- Brand kit with new logo and visual identity
- Outer loop implementation for pattern detection and learning consolidation
- Learning manager for tracking, deduplicating, and promoting learnings
- Pattern detector for identifying failure, iteration, and success patterns
- Automatic guideline updates from promoted learnings
- Criteria change proposals with human approval workflow
- Digest generation for outer loop reviews
- `ophan review` command to run outer loop manually
- `ophan logs` command to view recent task logs
- Webhook notifications for escalations and digests
- CLI with `ophan init`, `ophan task`, and `ophan status` commands
- Inner loop task execution with generate-evaluate-learn-regenerate cycle
- Claude API integration for task execution
- Project scaffolding with guidelines and criteria templates
- TypeScript, Python, and base project templates
- Configuration via `.ophan.yaml`
- State management in `.ophan/state.json`
- Task logging to `.ophan/logs/`
- Cost tracking and iteration limits
- Escalation on max iterations or cost limit exceeded
- GitHub Actions CI workflow for automated testing
- CONTRIBUTING.md with contribution guidelines

### Changed
- Updated CLI output colors to match brand guidelines (gold accent)
- Improved UI styling with dark theme
- Upgraded zod to v4 for compatibility with Claude Agent SDK

[Unreleased]: https://github.com/cymfg/ophan/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/cymfg/ophan/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/cymfg/ophan/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/cymfg/ophan/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/cymfg/ophan/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/cymfg/ophan/compare/v0.3.0...v0.3.2
[0.3.0]: https://github.com/cymfg/ophan/releases/tag/v0.3.0
