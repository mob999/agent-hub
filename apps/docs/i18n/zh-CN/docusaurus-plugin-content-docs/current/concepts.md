---
id: concepts
sidebar_position: 3
title: 核心概念
---

# 核心概念

## 会话

会话是主要工作空间。私聊会话对应一个 Agent；群组或项目会话可以包含多个 Agent 和一个 orchestrator。

## Agent

Agent 代表本地或云端 runtime，例如 Codex、Claude Code、OpenCode 或自定义适配器。每个 Agent 都有资料、runtime 绑定、workspace 状态和可选 memory。

## Run

Run 是由用户消息创建的一次执行任务。Run 会经历 queued、running、succeeded、failed、cancelled、interrupted 或 blocked 等状态。

## 目标与任务

Orchestrator 可以创建目标并把任务分派给 Agent。Tavro 会把这些内容渲染成结构化卡片和任务视图，而不仅是纯文本。

## Artifact

Artifact 是生成结果，例如文件、预览、部署记录或项目变更。它们会关联到对应会话和 Run。

## Daemon

Daemon 是本地执行器。它和 Tavro 保持出站连接，接收授权后的 Run，调用本地工具，并把事件流回传给 Worker。
