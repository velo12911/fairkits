
# FairKits Agent Instructions

Read PROJECT.md before making changes.

## Development Rules
- Follow the approved MVP scope.
- Prefer simple, readable JavaScript.
- Keep allocation logic separate from UI code.
- Do not add dependencies without approval.
- Do not change shared interfaces without approval.
- Never modify files owned by another developer
  without coordination.
- Validate all user input.
- Never silently alter allocation results.

## Workflow
1. Inspect relevant files.
2. Propose a short implementation plan.
3. List assumptions and files to be changed.
4. Implement after approval.
5. Run relevant tests.
6. Summarize changes and remaining risks.

## Verification
Check inventory conservation, request limits,
determinism, and invalid-input handling.

## Commands
npm run dev
npm run build
