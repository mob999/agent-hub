---
name: tavro-daemon-release
description: Use for Tavro daemon npm packaging, `@tavro-ai/daemon` publishing, generated `npx ... connect` commands, local daemon verification, MCP relay, worker gateway connection issues, or Windows CLI/stdin daemon runtime debugging.
---

# Tavro Daemon Release

## Package Model

- Source daemon app lives in `apps/daemon` as `@agent-hub/daemon`.
- Published npm package lives in `packages/tavro-daemon` as `@tavro-ai/daemon`.
- Production generated commands should use `npx -y @tavro-ai/daemon@latest connect ...`.
- Local development should keep source-based commands for fast debugging.

## Release Flow

1. Update `packages/tavro-daemon/package.json` version before publishing.
2. Build with `pnpm --filter @tavro-ai/daemon build`.
3. Dry-run package contents with `pnpm --filter @tavro-ai/daemon pack:dry-run`.
4. Trigger the `Publish Daemon` GitHub workflow manually with the exact version.
5. Ensure the workflow version input equals the package version.
6. Do not republish an existing npm version; bump patch if needed.

## Runtime Debugging

- Check generated command contains the correct worker gateway URL, daemon device id, and device token.
- API and Worker must share the same daemon token secret for production device tokens.
- When the daemon reconnects repeatedly, inspect Worker gateway logs and token validation before changing the CLI.
- For Windows issues, check shell quoting, `cmd` vs PowerShell semantics, and stdin behavior.
- Prefer avoiding stdin-dependent adapter flows when prompt arguments or temp files are safer across Windows environments.
- MCP relay behavior lives in the daemon layer; verify that the packaged daemon includes MCP relay entrypoints before publishing.

## Local Verification

- Start infrastructure: `pnpm infra:up`
- Migrate local DB: `pnpm --filter @agent-hub/db db:migrate`
- Run services in separate terminals:
  - `pnpm --filter @agent-hub/api dev`
  - `pnpm --filter @agent-hub/worker dev`
  - `pnpm --filter @agent-hub/daemon dev`
- Expected logs include API listening, Worker gateway listening, Worker run jobs listening, and Daemon connected.

## CI And Publish Cautions

- The package build depends on building `@agent-hub/core`, `@agent-hub/config`, and `@agent-hub/daemon`.
- If tsup cannot resolve internal packages, confirm those internal package builds run before packaging.
- npm auth should use `NPM_TOKEN` in GitHub secrets, not a token committed to the repo.
