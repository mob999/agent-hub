---
id: deployment
sidebar_position: 5
title: Deployment overview
---

# Deployment overview

Tavro uses a simple production split:

- Web: Vercel
- API: Railway
- Worker and Redis: Railway
- Database: Supabase Postgres
- Daemon: npm package

## Promotion model

Feature work lands on `dev`. Production deployment is triggered by manually promoting `dev` to `main` through the GitHub workflow.

The promotion workflow can run:

- `pnpm check`
- production database migrations
- a fast-forward update of `main`

Vercel and Railway then deploy from the production branch through their platform integrations.

## Important environment variables

- `DATABASE_URL`
- `REDIS_URL`
- `AGENTHUB_PUBLIC_WEB_URL`
- `AGENTHUB_DAEMON_TOKEN_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_OAUTH_CALLBACK_URL`

Keep secrets in the platform secret stores. Do not commit them to the repository.
