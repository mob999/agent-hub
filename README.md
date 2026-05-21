# AgentHub

AgentHub 是一个基于 IM 聊天范式的多 Agent 协作平台。用户可以像使用飞书或微信一样新建对话、发送消息、@ 不同 Agent，并在聊天流中查看文本回复、代码 Diff、网页预览、文件附件等产物。

当前仓库是 AgentHub 的 TypeScript monorepo 初始骨架，包含 Web 前端、API 服务、后台 worker、本地 daemon 和共享 packages。

## 技术栈

- 包管理：pnpm workspace
- 任务编排：Turborepo
- 前端：Vite + React + TypeScript
- 后端：Hono + Node.js
- Worker：TypeScript 后台任务进程
- Daemon：TypeScript 本地轻量服务
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
    protocol/        # 共享协议和核心类型
    sdk/             # 客户端 API SDK
    db/              # 数据库 schema 和数据访问
    agent-adapters/  # Agent 适配器
    orchestrator/    # 多 Agent 编排
    artifacts/       # 产物模型
    ui/              # 共享 UI 封装
    config/          # 共享配置
    logger/          # 统一日志

  infra/             # 基础设施配置
  scripts/           # 开发和发布脚本
  docs/              # 项目文档
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

## 常用命令

```bash
pnpm dev           # 启动所有带 dev 脚本的 workspace
pnpm build         # 构建所有 workspace
pnpm lint          # 运行 lint
pnpm test          # 运行单元测试
pnpm test:coverage # 运行单元测试并输出覆盖率
pnpm typecheck     # 运行类型检查
pnpm check         # 运行 lint、typecheck 和 test
```

## 测试说明

项目使用 Vitest 作为单元测试框架。测试文件放在对应 app 或 package 的 `src` 目录下，文件名使用：

```txt
*.test.ts
*.spec.ts
*.test.tsx
*.spec.tsx
```

单独运行 logger 包测试：

```bash
pnpm --filter @agent-hub/logger test
```

需要优先补单测的代码：

- 有明确业务规则的代码，例如 Run 状态流转、权限判断、Workflow 编排。
- 有分支和边界条件的纯函数，例如协议转换、Artifact 类型判断、配置解析。
- 外部系统适配层，例如 Agent adapter 的入参/出参映射、错误归一化、重试策略。
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

启动 worker：

```bash
pnpm --filter @agent-hub/worker dev
```

启动 daemon：

```bash
pnpm --filter @agent-hub/daemon dev
```

## 当前状态

当前项目处于初始化阶段，已经完成 monorepo 骨架、Vite Web 应用、Hono API 应用、worker/daemon 运行单元和共享 packages 的基础配置。

后续优先实现第一条单 Agent 聊天闭环：对话列表、对话详情、消息输入、Run 创建、流式回复和基础 Artifact 卡片。
