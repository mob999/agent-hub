---
id: faq
sidebar_position: 6
title: FAQ
---

# FAQ

## Is Tavro a chat app or an automation platform?

Both, but the interaction model is chat-first. The chat stream is where users ask for work, agents coordinate, and outputs remain visible.

## Does the browser run agents?

No. The browser only handles interaction and display. Long-running work is executed by the worker or by an authorized daemon.

## Why is the daemon local?

Some tools, credentials, and project files live on the user's machine. The daemon gives Tavro access to authorized local workspaces without moving all execution into the browser.

## Why split API and Worker?

Agent work can run for a long time. The API should remain a responsive control plane, while the worker handles queues, execution, retries, and streaming events.

## Can I deploy only the web app first?

Yes, but login and workspace features need the API and database. A deployed web app is still useful for GitHub OAuth and product preview setup.
