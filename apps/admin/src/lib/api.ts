export interface AdminPrincipal {
  email: string
  id: string
  role: 'admin'
}

export interface AdminUser {
  avatar: string | null
  createdAt: string
  email: string
  id: string
  name: string | null
  oauthProviderCount: number
  sessionCount: number
  updatedAt: string
  welcomeOnboardingCompletedAt: string | null
}

export interface AdminUserDetail extends AdminUser {
  lastSessionCreatedAt: string | null
  oauthProviders: string[]
}

export interface AdminMeResponse {
  admin: AdminPrincipal
  user: {
    avatar: string | null
    email: string
    id: string
    name: string | null
  }
}

export interface AdminUsersResponse {
  total: number
  users: AdminUser[]
}

export interface ObservabilityConfig {
  allowedVariables: Array<'service' | 'level' | 'query'>
  defaultDashboardPath: string
  grafanaUrl: string
}

interface ApiErrorPayload {
  error?: {
    code?: string
    message?: string
  }
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

function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_AGENTHUB_API_URL

  if (import.meta.env.DEV) {
    if (
      configured === undefined ||
      configured === 'http://localhost:3000' ||
      configured === 'http://127.0.0.1:3000'
    ) {
      return ''
    }
  }

  return configured ?? 'http://localhost:3000'
}

const apiBaseUrl = resolveApiBaseUrl()

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
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
