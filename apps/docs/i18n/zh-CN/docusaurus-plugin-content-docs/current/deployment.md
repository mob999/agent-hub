---
id: deployment
sidebar_position: 5
title: 部署概览
---

# 部署概览

Tavro 的生产部署拆分如下：

- Web：Vercel
- API：Railway
- Worker 和 Redis：Railway
- 数据库：Supabase Postgres
- Daemon：npm package

## 发布模式

功能开发进入 `dev`。生产上线通过 GitHub workflow 手动把 `dev` fast-forward 到 `main`。

Promote workflow 可以执行：

- `pnpm check`
- 生产数据库迁移
- fast-forward 更新 `main`

随后 Vercel 和 Railway 会根据平台集成从生产分支部署。

## 关键环境变量

- `DATABASE_URL`
- `REDIS_URL`
- `AGENTHUB_PUBLIC_WEB_URL`
- `AGENTHUB_DAEMON_TOKEN_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_OAUTH_CALLBACK_URL`

密钥必须放在平台的 secret/env 配置里，不要提交到仓库。
