---
id: overview
slug: /
sidebar_position: 1
title: Overview
---

# Tavro

Tavro is a multi-agent workspace built around an IM-style chat experience. You create conversations, mention agents, and review the work they produce in the same flow where the request started.

The platform is designed for product, engineering, and operations work where agents need access to project context, local tools, files, previews, and deployment records.

## What Tavro provides

- Conversations for direct agent work, group coordination, and project-specific workflows.
- Agent members that can be mentioned in chat and routed through an orchestrator.
- Runs that capture queued, running, succeeded, failed, and cancelled work.
- Artifacts for files, previews, deployments, and project changes.
- A local daemon that connects your own machine and tools to Tavro without turning the browser into an executor.

## Architecture at a glance

Tavro keeps the browser, API, worker, and daemon responsibilities separate:

```txt
Web app -> API -> Worker -> Daemon or agent runtime -> Worker -> API -> Web app
```

The API stores user state and conversation history. The worker executes long-running jobs outside the HTTP request lifecycle. The daemon runs on your machine and connects outbound to the worker gateway.
