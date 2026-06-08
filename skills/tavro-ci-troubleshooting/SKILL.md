---
name: tavro-ci-troubleshooting
description: Use when Tavro GitHub Actions CI, promote-production, publish-daemon, lint, typecheck, tests, builds, Vercel, Railway, or npm publish workflows fail and need diagnosis or repair.
---

# Tavro CI Troubleshooting

## First Response

1. Check the local branch and cleanliness with `git status --short --branch`.
2. List recent runs with `gh run list --branch dev --limit 5` or the relevant branch.
3. Open the failing run with `gh run view <run-id> --log-failed`.
4. Identify the exact failing command and package before editing code.

## Reproduce Locally

- CI runs `pnpm check`, which expands to lint, typecheck, and tests.
- If lint fails, run the narrow command first, such as `pnpm --filter @agent-hub/web lint`.
- If typecheck fails, run the relevant package typecheck before broadening.
- If tests fail, run the specific package or test file before `pnpm check`.
- After fixing, run the failed command and then `pnpm check` when practical.

## Known Signals

- A warning in `apps/web/src/components/ArtifactWorkspace.tsx` about a missing hook dependency is currently known; it is not a CI failure by itself.
- ESLint unused variables fail CI even when `build` and `typecheck` pass.
- Publish daemon workflow fails when the input version does not match `packages/tavro-daemon/package.json` or when the version already exists on npm.
- Promote workflow fails when `main` cannot fast-forward from the selected source ref.

## Fix And Confirm

1. Keep the fix minimal and targeted to the failing cause.
2. Commit with a clear `fix(...)` message.
3. Push to the same branch that triggered CI.
4. Watch the new run with `gh run watch <run-id> --exit-status` when useful.
5. Report the failing cause, the fix, and validation results.
