---
name: tavro-frontend-experience
description: Use when designing or changing Tavro web UI, React components, chat/message UX, loading states, empty states, realtime notifications, sidebar behavior, Welcome, Tasks, Runs, Daemon, Artifact, Project, or Search surfaces in apps/web.
---

# Tavro Frontend Experience

## Product Feel

- Treat Tavro as a work-focused AI Agent IM workspace, not a marketing site.
- Prefer dense but readable layouts, quiet visual hierarchy, compact controls, and fast perceived feedback.
- Keep the first screen usable; avoid explanatory in-app text that describes features instead of enabling work.
- Match the existing visual language: light borders, subtle shadows, modest radii, real avatars, compact panels, and restrained color.

## UI Patterns

- Use Carbon components where they already fit, and Tailwind utility classes for the app's custom workspace polish.
- Use icons for tool actions and concise text for commands that need clarity.
- Keep page sections unframed; use cards only for repeated items, modals, and bounded tools.
- Avoid nested cards and decorative gradients/orbs.
- Make loading, empty, queued, failed, and success states visible in the place where the user is working.
- Prefer optimistic UI for user actions when the final server response can safely replace the local placeholder.

## Data And State

- Use TanStack Query for API/server state and invalidate or update query cache after writes.
- Keep route selection, drafts, modals, form errors, local pending states, toasts, and search UI in component/local state.
- Realtime events should update both local display state and query cache where applicable.
- Avoid localStorage persistence for server state; prevent cross-account stale data.

## Chat And Sidebar UX

- Messages should appear immediately when a user sends them; queue/running/error indicators belong near the message, not only in global toasts.
- Use real user/agent avatars when available; fallback to initials only when necessary.
- Do not auto-select the first conversation from `/welcome` or `/chat`; preserve explicit user navigation.
- For agent direct conversations, use known conversation ids immediately and only call ensure/create when no existing direct conversation is known.

## Validation

- Run `pnpm --filter @agent-hub/web lint` for lint-sensitive changes.
- Run `pnpm --filter @agent-hub/web typecheck` for all React/TypeScript changes.
- Run `pnpm --filter @agent-hub/web build` before finishing visible UI work.
- For larger state/cache changes, run `pnpm check`.
