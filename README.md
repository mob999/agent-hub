# AgentHub

AgentHub 是一个基于 IM 聊天范式的多 Agent 协作平台。用户可以像使用飞书或微信一样新建对话、发送消息、@ 不同 Agent，并在聊天流中查看文本回复、代码 Diff、网页预览、文件附件、站点部署和项目文件变更等产物。

当前仓库是 AgentHub 的 TypeScript monorepo，包含 Web 前端、API 服务、后台 worker、本地 daemon、数据库 schema 和共享 packages。项目已经具备基础登录、会话、Agent、Run、Artifact、daemon 管理和实时事件链路。

## 当前能力

- Web 工作台：登录、对话侧边栏、Agent 管理、群聊/项目会话、搜索、Runs、Daemon 页面、Artifact 工作区、项目文件视图。
- API 控制面：auth、agents、search、conversations、messages、project files/changes、artifacts、deployments、runs、daemon devices、SSE realtime。
- Worker：后台任务入口和 daemon gateway。
- Daemon：本地 runtime registry、Claude/Codex 适配、MCP relay、workspace 工具、memory/context compression 支持。
- 数据层：PostgreSQL + Drizzle schema/migrations，Redis 用于队列、缓存和实时协调。

## 技术栈

- 包管理：pnpm workspace
- 任务编排：Turborepo
- 前端：Vite + React + TypeScript + Carbon Design System + Monaco Editor
- 后端：Hono + Node.js + `@hono/zod-openapi`
- Worker：TypeScript 后台任务进程
- Daemon：TypeScript 本地轻量服务
- 数据库：PostgreSQL + Drizzle ORM
- 实时/队列：Redis + SSE/WebSocket
- 测试：Vitest

## 目录结构

```txt
agent-hub/
  apps/
    web/             # Vite React 静态 SPA
    api/             # Hono API 服务
    worker/          # 后台长任务执行器
    daemon/          # 用户本地轻量服务
    desktop/         # 预留：桌面客户端
    mobile/          # 预留：移动端客户端

  packages/
    config/          # 环境变量解析和运行配置
    core/            # browser-safe，共享协议、Agent/runtime/artifact 契约和纯逻辑
    server/          # Node-only，日志和后端工具
    db/              # 数据库 schema 和数据访问

  infra/             # 基础设施配置
  scripts/           # 开发和发布脚本
  docs/              # 项目文档
```

API 服务已经模块化：

```txt
apps/api/src/
  index.ts           # 启动入口
  app.ts             # OpenAPIHono app 组装
  context.ts         # API 运行上下文
  auth/              # session 和 auth middleware
  routes/            # 按领域拆分的 OpenAPI routes
  schemas/           # Zod/OpenAPI schemas
  services/          # API 层组合 helper
```

## 环境要求

- Node.js 22+
- pnpm 10+

本仓库通过根目录 `package.json` 固定包管理器版本：

```txt
pnpm@10.15.0
```

## 安装依赖

```bash
pnpm install
```

## 本地基础设施

开发环境使用 Docker Compose 启动 PostgreSQL 和 Redis。数据库和队列服务只作为本地依赖，不包含应用进程。

```bash
pnpm infra:up
```

默认连接信息在 [.env.example](.env.example) 中：

```txt
DATABASE_URL=postgres://agent_hub:agent_hub@localhost:5432/agent_hub
REDIS_URL=redis://localhost:6379
```

常用基础设施命令：

```bash
pnpm infra:up     # 启动 PostgreSQL 和 Redis
pnpm infra:down   # 停止服务，保留数据卷
pnpm infra:logs   # 查看服务日志
pnpm infra:reset  # 停止服务并删除数据卷
```

如果只是第一次启动开发环境，推荐流程是：

```bash
pnpm install
pnpm infra:up
pnpm dev
```

默认开发端口：

```txt
Web:    http://localhost:5173
API:    http://localhost:3000
Worker: http://localhost:3001
```

## 常用命令

```bash
pnpm dev           # 启动所有带 dev 脚本的 workspace
pnpm build         # 构建所有 workspace
pnpm infra:up      # 启动本地 PostgreSQL 和 Redis
pnpm infra:down    # 停止本地基础设施
pnpm lint          # 运行 lint
pnpm test          # 运行单元测试
pnpm test:coverage # 运行单元测试并输出覆盖率
pnpm typecheck     # 运行类型检查
pnpm check         # 运行 lint、typecheck 和 test
```

## 测试说明

项目使用 Vitest 作为单元测试框架。单元测试文件放在对应 app 或 package 的 `tests/unit` 目录下，文件名使用：

```txt
*.test.ts
*.spec.ts
*.test.tsx
*.spec.tsx
```

例如：

```txt
tests/unit/agent.test.ts
```

单独运行 server 包测试：

```bash
pnpm --filter @agent-hub/server test
```

需要优先补单测的代码：

- 有明确业务规则的代码，例如 Run 状态流转、权限判断、Workflow 编排。
- 有分支和边界条件的纯函数，例如协议转换、Artifact 类型判断、配置解析。
- 外部系统适配层，例如 runtime adapter 的入参/出参映射、错误归一化、重试策略。
- 安全相关逻辑，例如 token 脱敏、授权 workspace 判断、命令参数拼接。
- 曾经出过 bug 或后续可能频繁变动的代码。

简单 re-export、没有逻辑的类型定义、脚手架样板代码和纯静态展示不要求一开始就补单测。

## 单独启动应用

启动 Web 前端：

```bash
pnpm --filter @agent-hub/web dev
```

启动 API 服务：

```bash
pnpm --filter @agent-hub/api dev
```

API 服务启动后可以查看 OpenAPI 文档：

```txt
http://localhost:3000/docs
http://localhost:3000/openapi.json
```

启动 worker：

```bash
pnpm --filter @agent-hub/worker dev
```

启动 daemon：

```bash
pnpm --filter @agent-hub/daemon dev
```

生产环境中，Web 端生成的 daemon 注册命令会使用 npm 包：

```bash
npx -y @tavro-ai/daemon@latest connect --gateway-url <worker-url> --device-id <device-id> --token <device-token>
```

本地开发仍保留源码调试命令，方便直接在 monorepo 中运行 daemon。生产 API 和 Worker 需要配置相同的 `AGENTHUB_DAEMON_TOKEN_SECRET`，用于派生和校验每个 daemon device 的 token。

## 当前状态

当前项目已完成第一阶段基础闭环的大部分工程面：

- `packages/core` 已定义 agent、artifact、conversation、daemon、mcp、realtime、run、search 等共享协议。
- `apps/api` 已从单文件入口拆为模块化 route/service 结构，并通过 OpenAPI 暴露主要路由。
- `apps/web` 已具备 IM 工作台的主要页面和组件。
- `apps/worker` 和 `apps/daemon` 已具备本地 daemon 连接、runtime 调用和 MCP relay 的基础能力。
- `packages/db` 和 `packages/server` 已承载主要数据模型、repository、queue、realtime 和领域工具。

后续重点是继续细化 API schema、补充 route/integration 测试、拆细 API service helper，并打磨消息发送、Run 调度、Artifact 发布和项目会话的稳定性。
