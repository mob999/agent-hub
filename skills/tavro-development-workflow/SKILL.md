---
name: tavro-development-workflow
description: Use when working in the Tavro/AgentHub repository on feature implementation, bug fixes, refactors, API route work, repository/service changes, database schema changes, or test additions. Follow this project's preferred development loop, code boundaries, validation commands, and git hygiene.
---

# Tavro Development Workflow

## Core Loop

1. Start by reading local truth: `git status --short --branch`, relevant files, route/service/repository boundaries, and recent patterns.
2. Prefer `rg` and targeted file reads before proposing or editing.
3. For ambiguous or cross-cutting changes, design a concrete plan first; for narrow fixes, implement directly.
4. Keep changes scoped to the requested behavior and the existing architecture.
5. Validate with the smallest meaningful command first, then broaden when risk or CI requires it.

## Architecture Boundaries

- Keep `apps/api/src/index.ts` as bootstrapping only and `apps/api/src/app.ts` as Hono/OpenAPI app assembly.
- Add JSON API routes with `createRoute + app.openapi(...)` or the existing OpenAPI helper; do not add new bare business `app.get/post/...` routes.
- Put domain data access and backend pure logic in `packages/server`; do not move repository logic back into API route handlers.
- Put browser-safe protocol/types in `packages/core`; keep Node-only code out of it.
- Keep database schema and migrations in `packages/db`.
- Preserve daemon as a local executor, worker as long-running task execution, and API as the control plane.

## Implementation Habits

- Use existing helpers and local conventions before adding abstractions.
- Use structured parsers/APIs rather than ad hoc string manipulation when available.
- Do not rewrite unrelated code, metadata, or formatting.
- Treat user changes in the working tree as intentional; never revert them unless explicitly asked.
- For frontend server state, prefer TanStack Query; keep local UI state local.
- For API changes, update schemas/types/tests alongside behavior when the response shape or contract changes.

## Validation

- Web-only changes: run `pnpm --filter @agent-hub/web typecheck` and usually `pnpm --filter @agent-hub/web build`.
- API/server/db changes: run the most relevant package tests, then typecheck the touched package.
- Shared protocol or cross-package changes: run `pnpm check`.
- Before pushing or when CI is likely to run, prefer `pnpm check`; CI runs exactly this command.
- Existing warning to recognize: `ArtifactWorkspace.tsx` has a known `react-hooks/exhaustive-deps` warning; do not treat it as a new failure unless it changes to an error.

## Git

- Work on `dev` unless instructed otherwise.
- Commit only after validation or after clearly reporting any validation gap.
- Use concise commit messages such as `feat(web): ...`, `fix(api): ...`, or `docs: ...`.
