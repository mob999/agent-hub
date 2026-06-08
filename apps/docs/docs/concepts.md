---
id: concepts
sidebar_position: 3
title: Concepts
---

# Concepts

## Conversations

Conversations are the primary workspace. A direct conversation maps to one agent. A group or project conversation can include multiple agents and an orchestrator.

## Agents

Agents represent local or cloud runtimes such as Codex, Claude Code, OpenCode, or custom adapters. Each agent has profile data, runtime binding, workspace status, and optional memory.

## Runs

A run is a unit of work created from a user message. Runs move through statuses such as queued, running, succeeded, failed, cancelled, interrupted, or blocked.

## Tasks and goals

The orchestrator can create goals and assign tasks to agents. Tavro renders these as structured cards and task views instead of plain text only.

## Artifacts

Artifacts are generated outputs such as files, previews, deployment records, or project changes. They are tied back to conversations and runs.

## Daemon

The daemon is a local executor. It keeps an outbound connection to Tavro, receives authorized run jobs, invokes local tools, and streams events back to the worker.
