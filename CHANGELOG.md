# Changelog

All notable changes to Ophan will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Changed
- Updated CLI output colors to match brand guidelines (gold accent)
- Improved UI styling with dark theme

[Unreleased]: https://github.com/cymfg/ophan/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/cymfg/ophan/releases/tag/v0.3.0
