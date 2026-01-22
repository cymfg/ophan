# Contributing to Ophan

Thank you for your interest in contributing to Ophan! This document provides guidelines and information for contributors.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ophan.git
   cd ophan
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development

### Commands

```bash
npm run dev -- <command>   # Run CLI in development mode
npm run build              # Build the project
npm run typecheck          # Run TypeScript type checking
npm test                   # Run tests
npm run test:coverage      # Run tests with coverage
npm run lint               # Run ESLint
```

### Project Structure

```
ophan/
├── src/
│   ├── cli/           # CLI commands and utilities
│   ├── core/          # Core logic (inner loop, outer loop, evaluation)
│   ├── llm/           # LLM integration (Claude API)
│   ├── integrations/  # External integrations (webhooks)
│   ├── types/         # TypeScript type definitions
│   └── ui/            # Web UI server and assets
├── tests/             # Test files
└── docs/              # Documentation
```

### Code Style

- Use TypeScript with strict type checking
- Follow existing patterns in the codebase
- No `any` types in production code
- Add JSDoc comments for public APIs
- Run `npm run typecheck` and `npm run lint` before committing

## Making Changes

### Before You Start

- Check existing [issues](https://github.com/cymfg/ophan/issues) to see if your idea is already being discussed
- For large changes, open an issue first to discuss the approach

### Commit Messages

Write clear, concise commit messages:

- Use present tense ("Add feature" not "Added feature")
- Use imperative mood ("Fix bug" not "Fixes bug")
- Keep the first line under 72 characters
- Reference issues when relevant (e.g., "Fix #123")

Examples:
```
feat: add support for custom evaluation criteria
fix: resolve race condition in task execution
docs: update configuration reference
refactor: simplify inner loop iteration logic
```

### Pull Requests

1. Ensure all tests pass: `npm test`
2. Ensure types check: `npm run typecheck`
3. Update documentation if needed
4. Fill out the PR template with:
   - Summary of changes
   - Related issues
   - Testing done

## Testing

- Write tests for new functionality
- Update tests when modifying existing code
- Tests should be deterministic and not depend on external services
- Run the full test suite before submitting a PR

## Reporting Issues

When reporting bugs, please include:

- Ophan version (`ophan --version`)
- Node.js version (`node --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Relevant error messages or logs

## Feature Requests

We welcome feature requests! When proposing a feature:

- Explain the problem you're trying to solve
- Describe your proposed solution
- Consider alternatives you've thought about
- Note if you're willing to implement it yourself

## Questions?

- Open a [GitHub Discussion](https://github.com/cymfg/ophan/discussions) for general questions
- Check existing issues and discussions first

## License

By contributing to Ophan, you agree that your contributions will be licensed under the MIT License.
