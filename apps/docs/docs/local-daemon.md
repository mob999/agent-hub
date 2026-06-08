---
id: local-daemon
sidebar_position: 4
title: Local daemon setup
---

# Local daemon setup

The daemon connects Tavro to tools installed on your machine. It is intentionally not a second backend: it executes authorized work and reports events back to the worker.

## Production command

Use the command generated from the Tavro web app:

```bash
npx -y @tavro-ai/daemon@latest connect --gateway-url <worker-url> --device-id <device-id> --token <device-token>
```

## Local development

When developing inside the monorepo, use the source daemon instead:

```bash
pnpm --filter @agent-hub/daemon dev
```

Start the API and worker in separate terminals:

```bash
pnpm --filter @agent-hub/api dev
pnpm --filter @agent-hub/worker dev
```

## Troubleshooting

- If the daemon reconnects repeatedly, check the worker gateway URL first.
- Ensure API and Worker share the daemon token secret in production.
- On Windows, check quoting and shell differences between PowerShell and `cmd`.
- Avoid stdin-dependent runtime flows when prompt arguments or temp files are safer.
