# Agent Rules

## Code Conventions
- Follow existing code styles in the repository
- Use the same libraries and utilities as the existing code
- Check imports and surrounding context before making changes
- Follow security best practices (never expose secrets/keys)

## Editing Guidelines
- Always read the file before editing using the Read tool
- Use exact string matching for edits (oldString must be found precisely)
- Prefer editing existing files over creating new ones
- Use `replaceAll` for renaming variables across the file
- When deleting or rewriting a function, remove all old code that is no longer needed
- When making fixes, always create a new version build and update the version number in package.json

## Verification
- Run `npm run check`, `npm test`, and `npm run test:e2e` before building
- After making changes, run `npm run build:win` to rebuild the EXE
- Check that the output matches expectations
- CI (`.github/workflows/ci.yml`) must pass before a build or release; tests use mocked services, never live APIs

## Commit Policy
- Only commit changes when explicitly requested by the user
- Inspect `git status` and `git diff` before committing
- Write concise commit messages matching repo style