---
name: tavro-production-deployment
description: Use for Tavro production deployment and environment work involving Vercel, Railway, Supabase, Redis, GitHub OAuth, CORS, production domains, database migrations, or promotion from dev to main.
---

# Tavro Production Deployment

## Deployment Model

- Web runs as a static SPA on Vercel.
- API, Worker, and Redis run on Railway.
- PostgreSQL runs on Supabase.
- Daemon is published to npm as `@tavro-ai/daemon`.
- Platform deployments may be automatic, but production rollout is controlled by manually promoting `dev` to `main`.

## Promotion Flow

1. Keep feature work on `dev`.
2. Confirm CI on `dev` is green or run `pnpm check` locally.
3. Use the `Promote to Production` GitHub workflow to fast-forward `main` from `dev`.
4. Keep `run_checks=true` unless there is a deliberate emergency exception.
5. Keep `run_migrations=true` when database migrations are part of the release.
6. Confirm Vercel and Railway platform deploys after `main` updates.

## Production Configuration Checklist

- `AGENTHUB_PUBLIC_WEB_URL` must match the production web origin, currently `https://tavro-ai.vercel.app/`.
- API CORS must allow the production Vercel origin.
- GitHub OAuth callback must point to the production API callback URL.
- API and Worker must share daemon token secrets.
- Worker gateway URL must match the Railway worker service URL used in generated daemon commands.
- Supabase migrations use GitHub secret `PROD_DATABASE_URL` in the promotion workflow.

## Common Commands

- Inspect workflows: `gh workflow list`
- Inspect promotion runs: `gh run list --workflow "Promote to Production"`
- View failure logs: `gh run view <run-id> --log-failed`
- Local full gate: `pnpm check`
- Production DB migration command used by workflow: `pnpm --filter @agent-hub/db db:migrate`

## Cautions

- Do not commit real secrets. Use GitHub, Railway, Vercel, or Supabase secret/env-variable stores.
- Supabase direct connection may need pooler URLs on IPv4-only networks.
- GitHub OAuth Apps only support one callback URL; local and production usually need separate OAuth Apps.
- Do not change `.env.example` production values unless the local default itself changes.
