---
id: local-daemon
sidebar_position: 4
title: 本地 daemon 设置
---

# 本地 daemon 设置

Daemon 把 Tavro 连接到用户机器上的本地工具。它不是第二套后端，只负责执行授权任务并把事件回传给 Worker。

## 生产命令

使用 Tavro Web 生成的命令：

```bash
npx -y @tavro-ai/daemon@latest connect --gateway-url <worker-url> --device-id <device-id> --token <device-token>
```

## 本地开发

在 monorepo 内开发时，使用源码 daemon：

```bash
pnpm --filter @agent-hub/daemon dev
```

API 和 Worker 分别在不同终端启动：

```bash
pnpm --filter @agent-hub/api dev
pnpm --filter @agent-hub/worker dev
```

## 排障

- 如果 daemon 一直重连，先检查 Worker gateway URL。
- 生产环境中 API 和 Worker 必须共享 daemon token secret。
- 在 Windows 上要检查 PowerShell 和 `cmd` 的引号、参数和 shell 差异。
- 如果 prompt 参数或临时文件更稳定，尽量避免依赖 stdin 的 runtime 流程。
