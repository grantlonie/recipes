# Contributing

Run the project's format check before opening a PR. This repo uses Prettier (see `.prettierrc`).

## File & naming conventions

### File naming

- **Components**: PascalCase (e.g. `UserProfile.tsx`)
- **Utilities / libs**: camelCase (e.g. `formatDate.ts`)
- **Types**: PascalCase for type and interface names; colocate or centralize per the project's shared-package conventions

### Code style

- **Formatting**: Prettier
- **Function declarations**: Prefer `function name() {}` over `const name = () => {}`
- **Named handlers**: Prefer named functions over inline arrow callbacks in JSX when the handler is non-trivial
- **Function order in modules**: Public entry points and callers first, private helpers below—rely on hoisting so helpers may appear after their first use
- **Programming paradigm**: Prefer functions over classes
- **Object sorting**: Alphabetical property ordering where practical
- **Component props**: Sort alphabetically in both type definitions and JSX usage
- **Comments**: Avoid unnecessary comments; prefer self-explanatory code
- **Imports**: Alphabetical order

## TypeScript

- **Strict typing**: Avoid `any`
- **Object shapes**: Prefer `interface` when extending; `type` is fine for unions and props aliases
- **Shared types**: Follow the project's shared package or colocation conventions

## React

### Component guidelines

1. Use functional components with hooks
2. Match patterns from existing components in the project
3. Name the props type `ComponentNameProps` (e.g. `DialogProps`)
4. Follow the project's chosen styling approach

### State management

- **Server state**: Use the project's data-fetching layer (e.g. TanStack Query)
- **Global UI state**: React Context
- **Local state**: `useState` / `useReducer`

## Code organization

- Keep related functionality together
- Check existing implementations before creating new abstractions
- Use the project's established import paths for shared code

## Performance

- Consider bundle size when adding dependencies
- Lazy-load heavy routes or components where appropriate
