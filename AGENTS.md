# AgentHub 初始设计

AgentHub 是一个简化版多 Agent 协作平台，核心交互范式是 IM 聊天。用户通过新建对话、发送消息、@ Agent 的方式，把 Claude Code、Codex、OpenCode 或自建 Agent 当作聊天对象来协作完成网页、Workflow、代码、文档、PPT 等产物。

本项目采用 TypeScript 全栈。前端是纯静态 SPA，后端、长任务执行和本地 daemon 分层独立，避免把 Agent 执行逻辑塞进前端或普通 HTTP 请求里。

## 产品模型

AgentHub 应该像一个面向 AI Agent 的 IM 工作台：

- 用户可以新建多个对话。
- 每个对话可以选择一个或多个 Agent。
- 每个 Agent 都表现为一个聊天成员。
- 群聊中可以 @ 多个 Agent。
- Orchestrator 负责协调多 Agent 分工，并按顺序产出回复。
- 每个对话保留完整聊天历史，Agent 可以基于历史消息理解上下文。
- Agent 回复不只是文本，也可以包含代码 Diff、网页预览、文件附件、文档、Workflow 结果和部署记录。
- 用户可以在聊天流中直接预览、编辑、应用和发布 Agent 产物。

## 架构原则

- Web、桌面端、移动端共享同一套 AgentHub 协议。
- Web 前端使用纯静态 SPA，不使用 Next.js，也不依赖 SSR。
- API 服务负责用户态数据、权限、会话历史、运行状态和产物元数据。
- 长时间运行的 Agent 任务必须脱离 HTTP 请求生命周期。
- daemon 是本地执行器，不是第二套后端。
- Runtime adapter 负责屏蔽 Claude Code、Codex、OpenCode 和自建 runtime 的接口差异；共享类型和契约统一放在 `packages/core`。
- 客户端通过 `packages/core` 中的共享协议类型与后端保持一致。
- 桌面客户端可以安装和管理 daemon，但业务行为应与 Web 端保持一致。
- 移动端一般不运行本地 daemon，而是远程控制云端 worker 或用户已连接的桌面 daemon。

## 运行边界

### UI 客户端

UI 客户端只负责交互和展示：

- 展示对话、消息、Agent、Workflow、Artifact 和 daemon 状态。
- 发送用户消息。
- 渲染流式运行事件。
- 渲染聊天内联产物。
- 打开预览和编辑器。
- 触发用户确认后的操作，例如重试、取消、部署、应用修改。

UI 客户端不负责 Agent 编排、Agent 执行、全局权限、计费或消息历史的权威存储。

### API 服务

API 服务是控制面：

- 认证和用户会话。
- 对话和消息持久化。
- Agent 注册和能力记录。
- Run 创建、状态跟踪和取消。
- Artifact 元数据和访问控制。
- daemon 注册和设备状态。
- 通过 SSE 或 WebSocket 提供实时消息。
- 将长任务投递给 worker 队列。

### Worker 服务

Worker 服务负责在 HTTP 请求之外执行长任务：

- 消费队列中的 Run。
- 调用云端 Agent 适配器。
- 在需要本地执行时把任务路由给已连接 daemon。
- 执行 Workflow 步骤。
- 持久化运行事件、日志、消息和 Artifact 记录。
- 支持重试、超时、取消和并发控制。

### Daemon

daemon 是运行在用户本机的轻量执行服务：

- 检测本机已安装的 Claude Code、Codex、OpenCode 等 Agent。
- 向后端注册设备和能力。
- 与后端保持出站连接。
- 接收经过授权的 Run 任务。
- 调用本地 Agent CLI 或本地工具。
- 只读写用户授权的 workspace。
- 将日志、消息、Diff、文件和状态事件流式回传给后端。
- 支持取消任务和健康检查。

daemon 不负责聊天历史主存储、用户系统、计费、全局权限或多用户协作状态。

## 推荐技术栈

### 工程管理

- pnpm，用于依赖管理和 workspace 管理。
- pnpm workspace，用于组织 `apps/*` 和 `packages/*`。
- Turborepo，用于 monorepo 任务编排和缓存。
- Vitest，用于单元测试。
- TypeScript project references，可在需要时用于跨包类型检查。
- 根目录 `package.json` 必须声明 `packageManager`，例如 `pnpm@10.x`。
- 内部包之间优先使用 `workspace:*` 依赖。

### 前端

- Vite
- React
- TypeScript
- Tailwind CSS
- Carbon Design System
- TanStack Router
- TanStack Query
- Zustand 或 Jotai，用于本地 UI 状态
- Monaco Editor，用于代码编辑和 Diff 预览

### 后端

- Hono，运行在 Node.js 上
- `@hono/zod-openapi`，用于 API 路由声明和 OpenAPI 文档生成
- PostgreSQL
- Drizzle ORM
- Redis
- BullMQ 或兼容的队列抽象
- SSE 和 WebSocket，用于实时更新
- S3 兼容对象存储，用于保存生成产物

### 本地基础设施

- 开发环境使用 Docker Compose 启动 PostgreSQL 和 Redis。
- PostgreSQL 默认数据库、用户和密码均为 `agent_hub`。
- 本地默认 `DATABASE_URL` 为 `postgres://agent_hub:agent_hub@localhost:5432/agent_hub`。
- 本地默认 `REDIS_URL` 为 `redis://localhost:6379`。
- `pnpm infra:down` 只停止服务并保留数据卷；`pnpm infra:reset` 会删除数据卷。

### Daemon

- TypeScript
- Node.js 或 Bun
- 出站 WebSocket 通信
- 本地进程执行封装
- 本地 workspace 和 Git 工具封装

### 未来客户端

- 桌面端：Electron 或 Tauri，复用 Web SPA，并额外负责 daemon 安装和管理。
- 移动端：如果追求原生体验，用 Expo 或 React Native；如果追求最大程度复用 Web UI，用 Capacitor。

## 高层运行流程

```txt
Web / Desktop / Mobile
  -> API 创建 Run
  -> API 持久化 queued 状态
  -> API 投递队列任务
  -> Worker 消费 Run
  -> Worker 选择云端 Agent 适配器或已连接 daemon
  -> Agent 或 daemon 流式返回 RunEvent
  -> API 持久化事件和 Artifact
  -> 实时通道推送更新给客户端
  -> UI 渲染消息和内联产物
```

## 当前项目结构

项目采用 TypeScript monorepo。这里记录当前仓库真实存在的包边界和运行边界，不把各应用内部目录写死。具体页面、模块、hooks、routes、components 等目录应在实现阶段根据实际代码演进。

依赖管理统一使用 pnpm。根目录保留 `pnpm-workspace.yaml`，workspace 范围默认覆盖 `apps/*` 和 `packages/*`。

```txt
agent-hub/
  apps/
    api/                  # Hono API 服务
    daemon/               # 用户本地轻量服务
    desktop/              # 预留：桌面客户端壳和 daemon 管理，目前为占位目录
    mobile/               # 预留：移动端客户端
    web/                  # Vite React 静态 SPA
    worker/               # 后台长任务执行器

  packages/
    config/               # 环境变量解析和运行配置
    core/                 # browser-safe，共享协议、Agent/runtime/artifact 契约和纯逻辑
    db/                   # 数据库 schema、迁移和数据访问
    server/               # Node-only，统一日志和后端工具

  infra/                  # 本地开发和部署基础设施
  scripts/                # 开发、检查、构建、发布脚本
  docs/                   # 架构、协议、daemon、适配器和部署文档

  .env.example
  .gitignore
  AGENTS.md
  README.md
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  vitest.config.ts
```

### API 服务内部结构

`apps/api` 已从单文件入口拆成模块化 Hono 应用。实现 API 时遵守以下边界：

- `src/index.ts` 只负责加载 env、创建 db/redis/logger、订阅 realtime 和启动 HTTP server。
- `src/app.ts` 负责创建 `OpenAPIHono`、注入 `env/db/user`、注册 Swagger/OpenAPI 和挂载各 route 模块。
- `src/context.ts` 定义 API 运行上下文；route 模块通过 `ApiRouteContext` 获取共享依赖。
- `src/routes/*` 按领域拆分路由，例如 auth、agents、conversations、conversation messages、project files、artifacts、daemon、runs、search、realtime。
- JSON API 路由必须使用 `createRoute + app.openapi(...)`，或使用 `routes/openapi.ts` 中的 `openApiRoute` helper 注册，避免继续新增裸 `app.get/post/...` 业务路由。
- `src/schemas/*` 放 OpenAPI/Zod schema；已有 `auth.ts` 和 `common.ts`，新增稳定请求/响应结构时优先补 schema。
- `src/services/api-services.ts` 目前承载从旧入口拆出的 API 组合 helper；后续可以继续按领域拆细，但不要把数据库 repository 逻辑搬回 API 层。
- 领域数据访问和后端纯逻辑优先放在 `packages/server`；browser-safe 类型和协议放在 `packages/core`。

## 本地开发基础设施

本地开发依赖由 `infra/docker-compose.yml` 管理，目前包含：

- PostgreSQL，用于业务数据。
- Redis，用于队列、缓存和实时任务协调。

根目录提供以下命令：

```bash
pnpm infra:up
pnpm infra:down
pnpm infra:logs
pnpm infra:reset
```

默认开发流程：

```bash
pnpm install
pnpm infra:up
pnpm dev
```

## 测试约定

项目统一使用 Vitest。根目录提供以下测试命令：

```bash
pnpm test
pnpm test:coverage
pnpm check
```

API OpenAPI 文档在本地 API 服务启动后可访问：

```txt
http://localhost:3000/docs
http://localhost:3000/openapi.json
```

各 workspace 如果包含测试，应在自己的 `package.json` 中提供 `test` 脚本。单元测试文件放在对应 app 或 package 的 `tests/unit` 目录下，命名为 `<subject>.test.ts`、`<subject>.spec.ts`、`<subject>.test.tsx` 或 `<subject>.spec.tsx`，例如 `tests/unit/agent.test.ts`。

优先为这些代码补单测：

- 有明确业务规则的代码，例如 Run 状态流转、权限判断、Workflow 编排和 Orchestrator 分工。
- 有分支和边界条件的纯函数，例如协议转换、Artifact 类型判断、配置解析和路径处理。
- 外部系统适配层，例如 runtime adapter 的入参/出参映射、错误归一化和重试策略。
- 安全相关逻辑，例如 token 脱敏、授权 workspace 判断、命令参数拼接。
- 曾经出过 bug 或后续会频繁变动的代码。

以下代码不要求一开始就补单测：

- 简单 re-export。
- 没有逻辑的类型定义。
- 脚手架样板代码。
- 纯静态 UI 展示。
- 很薄的框架 glue code。

## 当前实现状态

当前仓库已经超过初始骨架阶段，形成了可运行的 AgentHub 雏形：

- Web SPA 已包含登录、工作台、对话侧边栏、Agent 管理、群聊/项目会话、搜索、Runs、Daemon 状态、Artifact 工作区和项目文件视图。
- API 已支持 auth、agents、search、conversations、message send、project files/changes、artifacts、deployments、runs、daemon devices 和 SSE realtime，并通过 OpenAPI 文档暴露主要路由。
- Worker 已包含 daemon gateway 和后台任务入口。
- Daemon 已包含 WebSocket client、本地 runtime registry、Claude/Codex runtime 适配、MCP relay、workspace 工具和 memory/context compression 相关逻辑。
- `packages/db` 已包含 auth、agents、conversations、runs 等 schema 与迁移。
- `packages/server` 已包含 agents、artifacts、conversations、queue、realtime、runs 等后端领域模块。
- `packages/core` 已包含 agent、artifact、conversation、daemon、mcp、realtime、run、search 等共享协议类型和纯逻辑。

后续优先级：

- 继续把 `apps/api/src/services/api-services.ts` 按领域拆细，减少单个 service 文件体积。
- 为 API route 增补更精确的 Zod request/response schema，而不是长期依赖通用 JSON schema。
- 补充可运行的 route/integration 测试，尤其是消息发送、Run 创建、Artifact 发布和 daemon device 流程。
- 打磨第一条单 Agent 和群聊/项目会话闭环的错误处理、取消、重试和用户可见状态。
