---
id: overview
slug: /
sidebar_position: 1
title: 概览
---

# Tavro

Tavro 是一个以 IM 聊天为核心体验的多 Agent 工作台。你可以创建会话、@ Agent，并在同一条工作流里查看 Agent 产出的消息、任务、文件、预览和部署记录。

它适合产品、工程和运营类工作，尤其适合 Agent 需要项目上下文、本地工具、文件、预览和部署信息的场景。

## Tavro 提供什么

- 支持单 Agent 私聊、群组协作和项目会话。
- Agent 可以像聊天成员一样被 @，并由 orchestrator 负责任务协调。
- Run 记录排队、运行、成功、失败和取消等执行状态。
- Artifact 保存文件、预览、部署记录和项目变更。
- 本地 daemon 连接你的电脑和工具，但不会把浏览器变成执行器。

## 架构概览

Tavro 把浏览器、API、Worker 和 daemon 的职责拆开：

```txt
Web app -> API -> Worker -> Daemon or agent runtime -> Worker -> API -> Web app
```

API 负责用户状态和会话历史。Worker 在 HTTP 请求之外执行长任务。Daemon 运行在用户机器上，并通过出站连接接入 Worker gateway。
