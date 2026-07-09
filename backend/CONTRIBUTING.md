# Contributing

Run the project's format and lint checks before opening a PR. This repo uses Ruff for formatting and linting (see `pyproject.toml`).

## File & naming conventions

### File naming

- **Modules / utilities**: snake_case (e.g. `format_date.py`)
- **Packages**: lowercase, no underscores when possible (e.g. `mypackage`)
- **Classes**: PascalCase (e.g. `UserProfile`)
- **Functions & variables**: snake_case (e.g. `format_date`, `user_id`)

### Code style

- **Formatting**: Ruff format (Black-compatible)
- **Function declarations**: Prefer plain `def name():` over lambdas when the logic is non-trivial
- **Function order in modules**: Public entry points and callers first, private helpers below
- **Programming paradigm**: Prefer functions over classes where practical
- **Comments**: Avoid unnecessary comments; prefer self-explanatory code
- **Imports**: Alphabetical order, grouped (stdlib → third-party → local) per Ruff/isort defaults

## Type hints

- **Strict typing**: Use type hints on public functions and methods; avoid untyped `Any` unless necessary
- **Object shapes**: Prefer `TypedDict` or dataclasses for structured data; `Protocol` for duck-typed interfaces
- **Shared types**: Follow the project's shared package or colocation conventions

## Python guidelines

1. Match patterns from existing modules in the project
2. Use context managers (`with`) for resources (files, connections, locks)
3. Prefer explicit exceptions over silent failures
4. Keep modules focused—one clear responsibility per file when practical

### State & data

- **Persistence**: Use the project's chosen ORM or data layer
- **Configuration**: Environment variables or a dedicated settings module
- **Caching**: Use the project's established caching approach (if any)

## Code organization

- Keep related functionality together
- Check existing implementations before creating new abstractions
- Use the project's established import paths for shared code

## Performance

- Consider dependency weight when adding packages
- Lazy-load heavy modules where appropriate
- Profile before optimizing hot paths
