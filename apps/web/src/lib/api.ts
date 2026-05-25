const apiBaseUrl = import.meta.env.VITE_AGENTHUB_API_URL ?? 'http://localhost:3000'

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type DeviceStatus = 'online' | 'offline' | string
export type WorkspaceView = 'chat' | 'runs' | 'daemon'
export type RuntimeKind = 'claude-code' | 'codex' | 'opencode' | 'custom'
export type AgentStatus = 'active' | 'disabled' | 'archived'
export type RuntimeBindingStatus = 'pending' | 'ready' | 'unavailable' | 'disabled'
export type AgentWorkspaceStatus = 'pending' | 'ready' | 'missing' | 'unavailable'

export interface RuntimeCapability {
  name: string
  enabled: boolean
  description?: string
}

export interface DaemonRuntime {
  daemonDeviceId: string
  runtimeKind: RuntimeKind
  runtimeVersion?: string
  executablePath?: string
  capabilities: RuntimeCapability[]
  status: 'ready' | 'unavailable' | 'disabled'
  lastSeenAt?: string
}

export interface User {
  id: string
  email: string
  name: string | null
}

export interface AuthResponse {
  user: User
}

interface ApiErrorPayload {
  error?: {
    code?: string
    message?: string
  }
}

export interface DaemonDevice {
  id: string
  status: DeviceStatus
  lastSeenAt: string | null
  runningRunIds: string[]
  runtimes: DaemonRuntime[]
}

export interface Agent {
  id: string
  ownerUserId: string
  name: string
  description?: string
  avatar?: string
  defaultRuntimeKind: RuntimeKind
  status: AgentStatus
  createdAt: string
  updatedAt: string
}

export interface AgentRuntimeBinding {
  agentId: string
  daemonDeviceId: string
  runtimeKind: RuntimeKind
  runtimeVersion?: string
  executablePath?: string
  capabilities: RuntimeCapability[]
  status: RuntimeBindingStatus
  lastSeenAt?: string
  error?: string
}

export interface AgentWorkspace {
  agentId: string
  daemonDeviceId: string
  workspacePath?: string
  status: AgentWorkspaceStatus
  syncMode: 'local-only'
  createdAt: string
  updatedAt: string
  error?: string
}

export interface AgentDetails {
  agent: Agent
  runtimeBinding: AgentRuntimeBinding
  workspace: AgentWorkspace
}

export interface AgentRun {
  id: string
  agentId: string
  daemonDeviceId: string
  status: RunStatus
  createdAt: string
  updatedAt: string
}

export interface RunEvent {
  type: string
  runId: string
  createdAt: string
  content?: string
  status?: RunStatus
  error?: string
  stream?: 'stdout' | 'stderr'
  line?: string
  name?: string
}

export interface LocalRun {
  channelId: string
  prompt: string
  run: AgentRun
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | T | null

  if (!response.ok) {
    const error = (payload as ApiErrorPayload | null)?.error
    throw new ApiRequestError(
      response.status,
      error?.message ?? 'Something went wrong. Please try again.',
      error?.code,
    )
  }

  return payload as T
}
