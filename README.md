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
pnpm dev        # 启动所有带 dev 脚本的 workspace
pnpm build      # 构建所有 workspace
pnpm lint       # 运行 lint
pnpm typecheck  # 运行类型检查
pnpm check      # 运行 lint 和 typecheck
```

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

