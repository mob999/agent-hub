---
id: quickstart
sidebar_position: 2
title: 快速开始
---

# 快速开始

部署好 Web 和后端后，可以按下面流程开始使用 Tavro。

## 1. 登录

打开 Tavro，并使用 GitHub 登录。

```txt
https://tavro-ai.vercel.app
```

## 2. 创建或连接 daemon

进入 Daemon 页面创建设备。Tavro 会生成一条命令，用来把你的本机连接到 Worker gateway。

生产环境命令使用 npm 包：

```bash
npx -y @tavro-ai/daemon@latest connect --gateway-url <worker-url> --device-id <device-id> --token <device-token>
```

## 3. 创建 Agent

创建 Agent，并绑定到已连接 daemon 上的可用 runtime。当 runtime 和 workspace 都就绪后，Agent 会出现在侧边栏中。

## 4. 开始会话

你可以创建单 Agent 私聊，也可以创建群组或项目会话，让多个 Agent 一起协作。

## 5. 发送任务

发送消息或使用 `@` 提及 Agent。Tavro 会创建 Run、推送进度，并保存消息、任务、Artifact 和部署记录。
