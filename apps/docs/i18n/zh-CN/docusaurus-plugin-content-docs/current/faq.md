---
id: faq
sidebar_position: 6
title: FAQ
---

# FAQ

## Tavro 是聊天应用还是自动化平台？

两者都是，但交互模型优先是聊天。用户在聊天流里发起工作，Agent 在这里协作，产物也留在这里。

## 浏览器会运行 Agent 吗？

不会。浏览器只负责交互和展示。长任务由 Worker 或授权后的 daemon 执行。

## 为什么需要本地 daemon？

有些工具、凭证和项目文件在用户本机。Daemon 让 Tavro 可以访问授权 workspace，而不需要把所有执行都塞进浏览器。

## 为什么 API 和 Worker 要拆开？

Agent 工作可能运行很久。API 应保持响应控制面请求，Worker 负责队列、执行、重试和事件流。

## 可以先只部署 Web 吗？

可以，但登录和工作台功能依赖 API 和数据库。单独部署 Web 仍然有助于配置 GitHub OAuth 和产品预览。
