const apiBaseUrl = import.meta.env.VITE_AGENTHUB_API_URL ?? 'http://localhost:3000'

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type DeviceStatus = 'online' | 'offline' | string
export type WorkspaceView = 'chat' | 'runs' | 'daemon'

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
