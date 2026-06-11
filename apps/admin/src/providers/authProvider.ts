import type { AuthProvider } from 'react-admin'
import { apiRequest, apiUrl, type AdminMeResponse } from '../lib/api'

let cachedIdentity: AdminMeResponse | null = null

function loginRedirect(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export const authProvider: AuthProvider = {
  async login() {
    const url = new URL(apiUrl('/auth/github/start'), window.location.origin)
    url.searchParams.set('redirect', loginRedirect())
    url.searchParams.set('web_origin', window.location.origin)
    window.location.href = url.toString()
  },

  async logout() {
    cachedIdentity = null
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined)
  },

  async checkAuth() {
    cachedIdentity = await apiRequest<AdminMeResponse>('/admin/me')
  },

  async checkError(error) {
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined

    if (status === 401 || status === 403) {
      cachedIdentity = null
      throw error
    }
  },

  async getIdentity() {
    const identity = cachedIdentity ?? await apiRequest<AdminMeResponse>('/admin/me')
    cachedIdentity = identity

    return {
      id: identity.user.id,
      fullName: identity.user.name ?? identity.user.email,
      avatar: identity.user.avatar ?? undefined,
    }
  },

  async getPermissions() {
    const identity = cachedIdentity ?? await apiRequest<AdminMeResponse>('/admin/me')
    cachedIdentity = identity
    return identity.admin.role
  },
}
