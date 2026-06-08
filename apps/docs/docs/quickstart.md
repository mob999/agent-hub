---
id: quickstart
sidebar_position: 2
title: Quickstart
---

# Quickstart

Use this flow to start working with Tavro after the web app and backend are deployed.

## 1. Sign in

Open Tavro and sign in with GitHub.

```txt
https://tavro-ai.vercel.app
```

## 2. Create or connect a daemon

Open the Daemon page and create a device. Tavro generates a command that connects your local machine to the worker gateway.

Production commands use the npm package:

```bash
npx -y @tavro-ai/daemon@latest connect --gateway-url <worker-url> --device-id <device-id> --token <device-token>
```

## 3. Create an agent

Create an agent and bind it to a ready runtime on your connected daemon. The agent becomes available in the sidebar when its runtime and workspace are ready.

## 4. Start a conversation

Create a direct conversation for one agent, or create a group/project conversation when you want multiple agents to collaborate.

## 5. Send work

Send a message or mention agents with `@`. Tavro queues a run, streams progress, and saves resulting messages, tasks, artifacts, and deployments.
