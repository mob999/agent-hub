# Daemon local verification

This guide verifies the local run loop:

```txt
API -> Redis Stream -> Worker daemon WebSocket gateway -> Daemon -> Codex -> Worker -> PostgreSQL
```

## 1. Start local infrastructure

```bash
pnpm install
pnpm infra:up
pnpm --filter @agent-hub/db db:migrate
```

Make sure `.env` exists at the repository root.

Linux/macOS example:

```env
DATABASE_URL=postgres://agent_hub:agent_hub@localhost:5432/agent_hub
REDIS_URL=redis://localhost:6379
AGENTHUB_DAEMON_TOKEN=dev-daemon-token
AGENTHUB_DEFAULT_DAEMON_DEVICE_ID=local-dev
AGENTHUB_DEFAULT_AGENT_ID=codex
WORKER_PORT=3001
AGENTHUB_DAEMON_GATEWAY_URL=http://localhost:3001
AGENTHUB_DEVICE_ID=local-dev
# Agent workspaces default to the current user's ~/.agent-hub directory.
```

Windows PowerShell example:

```env
DATABASE_URL=postgres://agent_hub:agent_hub@localhost:5432/agent_hub
REDIS_URL=redis://localhost:6379
AGENTHUB_DAEMON_TOKEN=dev-daemon-token
AGENTHUB_DEFAULT_DAEMON_DEVICE_ID=local-dev
AGENTHUB_DEFAULT_AGENT_ID=codex
WORKER_PORT=3001
AGENTHUB_DAEMON_GATEWAY_URL=http://localhost:3001
AGENTHUB_DEVICE_ID=local-dev
# Agent workspaces default to the current user's ~/.agent-hub directory.
```

## 2. Start the three services

Use three terminals.

```sh
pnpm --filter @agent-hub/api dev
pnpm --filter @agent-hub/worker dev
pnpm --filter @agent-hub/daemon dev
```

Run one command per terminal.

Expected signals:

- API log contains `"msg":"API server listening"`.
- Worker log contains `"msg":"Worker gateway listening"`.
- Worker log contains `"msg":"Worker listening for run jobs"`.
- Daemon log contains `"msg":"Daemon connected"`.

## 3. Verify auth is required

Linux/macOS:

```bash
curl -i \
  -X POST \
  http://localhost:3000/runs \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"should fail"}'
```

Windows PowerShell:

```powershell
Invoke-WebRequest `
  -Method Post `
  -Uri "http://localhost:3000/runs" `
  -ContentType "application/json" `
  -Body '{"prompt":"should fail"}'
```

Expected result: HTTP `401`.

## 4. Register a local user

Linux/macOS:

```bash
cookie_jar="$(mktemp)"
email="local-dev+$(date +%s)@example.com"

curl -i \
  -c "$cookie_jar" \
  -X POST \
  http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"Password123!\",\"name\":\"Local Dev\"}"
```

Windows PowerShell:

```powershell
$email = "local-dev+$([Guid]::NewGuid().ToString('N'))@example.com"

$registerBody = @{
  email = $email
  password = "Password123!"
  name = "Local Dev"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/auth/register" `
  -ContentType "application/json" `
  -Body $registerBody `
  -SessionVariable session
```

Linux/macOS keeps the auth cookie in `$cookie_jar`. Windows PowerShell keeps it in `$session`.

## 5. Confirm daemon is online

Linux/macOS:

```bash
curl -s \
  -b "$cookie_jar" \
  http://localhost:3000/daemon/devices
```

Windows PowerShell:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "http://localhost:3000/daemon/devices" `
  -WebSession $session
```

Expected result includes:

```json
{
  "id": "local-dev",
  "status": "online"
}
```

## 6. Create a run

Linux/macOS:

```bash
run_response="$(
  curl -s \
    -b "$cookie_jar" \
    -X POST \
    http://localhost:3000/runs \
    -H 'Content-Type: application/json' \
    -d '{"prompt":"Reply with a short hello from the daemon."}'
)"

echo "$run_response"
run_id="$(node -e "console.log(JSON.parse(process.argv[1]).run.id)" "$run_response")"
echo "$run_id"
```

Windows PowerShell:

```powershell
$runResponse = Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3000/runs" `
  -ContentType "application/json" `
  -Body '{"prompt":"Reply with a short hello from the daemon."}' `
  -WebSession $session

$runId = $runResponse.run.id
$runId
```

Expected service logs:

- Worker log contains `"msg":"Dispatched run to daemon"`.
- Daemon runs Codex.

## 7. Poll persisted run events

Linux/macOS:

```bash
curl -s \
  -b "$cookie_jar" \
  "http://localhost:3000/runs/$run_id/events"
```

Windows PowerShell:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "http://localhost:3000/runs/$runId/events" `
  -WebSession $session
```

Expected event sequence includes:

```txt
run.queued
run.started
message.delta
run.completed
```

Check final run status.

Linux/macOS:

```bash
curl -s \
  -b "$cookie_jar" \
  "http://localhost:3000/runs/$run_id"
```

Windows PowerShell:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "http://localhost:3000/runs/$runId" `
  -WebSession $session
```

Expected final status: `succeeded`.
