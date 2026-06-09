# Tavro
Demo地址: https://tavro-ai.vercel.app/  
---
Tavro 是一个基于 IM 聊天范式的多 Agent 协作工作台。用户可以新建单聊、群聊或项目会话，把 Claude Code、Codex 等本地 runtime 背后的 Agent 当作聊天成员，通过消息、@、Goal/Task、Artifact 和项目变更协作完成网页、代码、文档、工作流等产物。

本仓库的工程名仍是 `agent-hub`，部分 package scope 仍使用 `@agent-hub/*`。产品名和对外展示名使用 Tavro；daemon npm 包使用 `@tavro-ai/daemon`。

## 当前能力

- 生产 GitHub-only 登录：Web 浏览器 OAuth，桌面端通过系统浏览器 OAuth 回跳 `tavro://`；本地开发可使用 developer 登录入口跳过 OAuth 配置。
- Web 工作台：Welcome dashboard、会话侧边栏、群聊/项目/Agent 会话、消息流、搜索、Runs、Daemon、任务页、Artifact 工作区、Project Code/Changes。
- 多 Agent 协作：群聊 @ Agent，协调者创建 Goal、分派 Task，聊天流用结构化卡片展示目标和任务派发。
- 长任务执行：API 创建 Run 并入队，Worker 消费队列，daemon gateway 将本地任务分发给在线 daemon。
- 本地执行器：daemon 检测 Claude Code/Codex runtime，封装 CLI 执行、JSONL 日志解析、MCP relay、workspace 和 memory。
- 产物闭环：Artifact 上传、预览、编辑、revision、action、静态站点 publish 和 deployment 记录。
- 桌面客户端：Electron Web 壳，托管 `npx @tavro-ai/daemon@latest connect`，支持检查 GitHub Release 更新。
- 文档站：`apps/docs` 使用 Docusaurus，作为独立静态站部署。

## 技术栈

- Monorepo：pnpm workspace + Turborepo
- 前端：Vite + React + TypeScript + Carbon Design System + Tailwind CSS + TanStack Query + Monaco Editor
- API：Hono + Node.js + `@hono/zod-openapi`
- Worker：TypeScript 后台进程 + Redis 队列 + WebSocket daemon gateway
- Daemon：TypeScript + Node.js + WebSocket + MCP stdio relay + local process adapters
- Desktop：Electron + electron-builder
- Docs：Docusaurus
- 数据层：PostgreSQL + Drizzle ORM
- 缓存/队列/实时协调：Redis
- 对象存储：local storage 或 S3-compatible storage，生产可接 Supabase Storage
- 测试：Vitest

## 目录结构

```txt
agent-hub/
  apps/
    web/             # Tavro Web，Vite React 静态 SPA
    docs/            # Tavro Docs，Docusaurus 静态文档站
    api/             # Hono API 控制面
    worker/          # 后台长任务执行器和 daemon gateway
    daemon/          # monorepo 内 daemon 源码实现
    desktop/         # Electron 桌面客户端
    mobile/          # 预留：移动端客户端

  packages/
    config/          # 环境变量解析和运行配置
    core/            # browser-safe，共享协议、runtime/artifact/conversation 契约
    db/              # Drizzle schema、迁移和数据库连接
    server/          # Node-only，repository、queue、cache、storage、realtime 等后端模块
    tavro-daemon/    # 发布到 npm 的 @tavro-ai/daemon 包装层

  docs/              # 架构、报告和工程文档
  infra/             # 本地 PostgreSQL/Redis Docker Compose
  scripts/           # 开发、启动和发布辅助脚本
  skills/            # Tavro 项目专用 Codex skills
```

API 服务已模块化：

```txt
apps/api/src/
  index.ts           # 启动入口
  app.ts             # OpenAPIHono app 组装
  context.ts         # API 运行上下文
  auth/              # GitHub OAuth、session、auth middleware
  routes/            # 按领域拆分的 OpenAPI routes
  schemas/           # Zod/OpenAPI schemas
  services/          # API 层组合 helper
```

## 环境要求

- Node.js 22+
- pnpm 10+
- Docker，用于本地 PostgreSQL 和 Redis

根目录 `package.json` 固定包管理器版本：

```txt
pnpm@10.15.0
```

## 快速开始

```bash
pnpm install
pnpm infra:up
cp .env.example .env
pnpm dev
```

默认本地端口：

```txt
Web:    http://localhost:5173
API:    http://localhost:3000
Worker: http://localhost:3001
Docs:   http://localhost:3002
```

本地 `.env` 至少需要可用的 PostgreSQL、Redis 和 daemon token 配置。默认开发连接信息在 [.env.example](.env.example) 中：

```txt
DATABASE_URL=postgres://agent_hub:agent_hub@localhost:5432/agent_hub
REDIS_URL=redis://localhost:6379
```

开发模式下可以不配置 GitHub OAuth。登录页会额外显示“以 developer 登录”的开发入口，使用内置 `developer@tavro.local` 用户进入应用。只有需要本地调试真实 GitHub OAuth 时，才需要填写 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 和 `GITHUB_OAUTH_CALLBACK_URL`。

## 本地基础设施

开发环境使用 Docker Compose 启动 PostgreSQL 和 Redis：

```bash
pnpm infra:up     # 启动 PostgreSQL 和 Redis
pnpm infra:down   # 停止服务，保留数据卷
pnpm infra:logs   # 查看服务日志
pnpm infra:reset  # 停止服务并删除数据卷
```

## 常用命令

```bash
pnpm dev           # 启动所有带 dev 脚本的 workspace
pnpm build         # 构建所有 workspace
pnpm lint          # 运行 lint
pnpm typecheck     # 运行类型检查
pnpm test          # 运行测试
pnpm test:coverage # 运行测试并输出覆盖率
pnpm check         # 运行 lint、typecheck 和 test
```

单独启动应用：

```bash
pnpm --filter @agent-hub/web dev
pnpm --filter @agent-hub/docs dev
pnpm --filter @agent-hub/api dev
pnpm --filter @agent-hub/worker dev
pnpm --filter @agent-hub/daemon dev
```

API 服务启动后可以查看 OpenAPI 文档：

```txt
http://localhost:3000/docs
http://localhost:3000/openapi.json
```

## Daemon

本地开发可以直接运行 monorepo 内 daemon：

```bash
pnpm --filter @agent-hub/daemon dev
```

生产和用户侧推荐使用 npm 包：

```bash
npx -y @tavro-ai/daemon@latest connect --gateway-url <worker-url> --device-id <device-id> --token <device-token>
```

生产 API 和 Worker 需要配置相同的 `AGENTHUB_DAEMON_TOKEN_SECRET`，用于生成和校验每个 daemon device token。桌面客户端会调用 `/daemon/desktop/bootstrap` 获取设备和 token，然后在后台托管同一条 npx 命令。

## Desktop

桌面端开发默认加载本地 Web dev server：

```bash
pnpm --filter @agent-hub/web dev
pnpm --filter @agent-hub/desktop dev
```

加载生产 Web 调试：

```bash
pnpm --filter @agent-hub/desktop dev:prod-web
```

构建桌面安装包：

```bash
pnpm --filter @agent-hub/desktop typecheck
pnpm --filter @agent-hub/desktop build
pnpm --filter @agent-hub/desktop dist
```

桌面端 V1 是 Web 壳，额外提供系统浏览器 GitHub 登录、托管本地 daemon 和 GitHub Release 更新检查。安装包通过手动 GitHub Actions `Publish Desktop` 发布。

## Docs

文档站在 `apps/docs`，使用 Docusaurus：

```bash
pnpm --filter @agent-hub/docs dev
pnpm --filter @agent-hub/docs build
pnpm --filter @agent-hub/docs typecheck
```

生产文档站作为独立 Vercel 项目部署，当前域名规划为 `https://tavro-docs.vercel.app`。

## 部署

当前生产部署模式：

- Web：Vercel，静态 SPA。
- Docs：Vercel，独立静态文档站。
- API/Worker/Redis：Railway。
- Database：Supabase PostgreSQL。
- Object Storage：Supabase Storage S3-compatible API。
- Daemon：npm 包 `@tavro-ai/daemon`。
- Desktop：GitHub Release。

GitHub OAuth 需要在 GitHub Developer settings 中创建 OAuth App，并把 callback URL 填到 `GITHUB_OAUTH_CALLBACK_URL`。生产环境必须配置 GitHub OAuth；本地开发如果不测试 GitHub 登录，可以留空并使用开发模式登录入口。

- 本地开发：`http://localhost:3000/auth/github/callback`
- 生产环境：`https://<api-domain>/auth/github/callback`
- 当前 Tavro 生产 API 示例：`https://tavro-api-production.up.railway.app/auth/github/callback`

同一个 GitHub OAuth App 只能配置一个 callback URL。如果需要同时支持本地和生产 GitHub 登录，建议分别创建 dev/prod 两个 OAuth App，并在本地 `.env` 和 Railway 生产环境中分别填写对应的 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`GITHUB_OAUTH_CALLBACK_URL`。

产物存储由 `AGENTHUB_STORAGE_DRIVER` 控制：

- `AGENTHUB_STORAGE_DRIVER=local`：使用本地文件系统，文件写入 `AGENTHUB_STORAGE_ROOT`。这是本地开发默认模式，不需要配置 OSS/S3 密钥。
- `AGENTHUB_STORAGE_DRIVER=s3`：使用 S3-compatible 对象存储。生产推荐使用该模式，并让 API 和 Worker 配置同一个 bucket，避免多容器环境下本地磁盘不共享导致 Artifact 或 Deployment 文件不可读。

关键环境变量：

- `DATABASE_URL`
- `REDIS_URL`
- `AGENTHUB_PUBLIC_WEB_URL`
- `AGENTHUB_DAEMON_GATEWAY_URL`
- `AGENTHUB_DAEMON_TOKEN_SECRET`
- `GITHUB_CLIENT_ID`，生产必填；本地仅测试 GitHub OAuth 时需要
- `GITHUB_CLIENT_SECRET`，生产必填；本地仅测试 GitHub OAuth 时需要
- `GITHUB_OAUTH_CALLBACK_URL`，生产必填；本地测试 GitHub OAuth 时使用 `http://localhost:3000/auth/github/callback`
- `AGENTHUB_STORAGE_DRIVER`，本地开发可用 `local`，生产推荐 `s3`
- `AGENTHUB_STORAGE_ROOT`，仅 `local` 模式需要
- `AGENTHUB_S3_ENDPOINT`，仅 `s3` 模式需要
- `AGENTHUB_S3_REGION`，仅 `s3` 模式需要
- `AGENTHUB_S3_ACCESS_KEY_ID`，仅 `s3` 模式需要
- `AGENTHUB_S3_SECRET_ACCESS_KEY`，仅 `s3` 模式需要
- `AGENTHUB_S3_BUCKET`，仅 `s3` 模式需要

发布流程：

- `ci.yml` 在 `dev` 和 `main` 上运行 `pnpm check`。
- `promote-production.yml` 手动将 `dev` fast-forward 到 `main`，并可选择执行生产数据库迁移。
- Vercel/Railway 监听 `main` 自动部署 Web/API/Worker。
- `publish-daemon.yml` 手动发布 `@tavro-ai/daemon` 到 npm。
- `publish-desktop.yml` 手动构建三端桌面安装包并发布到 GitHub Release。

## 测试

项目使用 Vitest。常用命令：

```bash
pnpm test
pnpm check
pnpm --filter @agent-hub/server test
pnpm --filter @agent-hub/api test
pnpm --filter @agent-hub/worker test
pnpm --filter @agent-hub/web typecheck
pnpm --filter @agent-hub/web build
```

优先补测试的区域：

- Run 状态流转、抢占、resume 和权限判断。
- Goal/Task 创建、分派、审批、完成和卡片消息。
- Artifact storage、revision、action、deployment。
- daemon gateway、runtime adapter、MCP relay、workspace path guard。
- GitHub OAuth、desktop OAuth、session cache 和路由权限。

## AI 协作约定

仓库根目录的 [AGENTS.md](AGENTS.md) 记录 Tavro/AgentHub 的架构边界、代码组织和开发约束。`skills/` 目录沉淀项目专用工作流，包括开发流程、前端体验、生产部署、CI 排障和 daemon 发版。后续使用 Codex 或其他 AI coding agent 接手任务时，应先阅读 `AGENTS.md`，再按任务类型参考对应 skill。
