import type { DataProvider, RaRecord } from 'react-admin'
import { apiRequest, type AdminUser, type AdminUserDetail, type AdminUsersResponse } from '../lib/api'

type Identifier = string | number
type ListParams = {
  filter?: unknown
  pagination?: {
    page?: number
    perPage?: number
  }
}
type IdParams = { id: Identifier }
type ManyParams = { ids: Identifier[] }

function searchFromFilter(filter: unknown): string | undefined {
  if (typeof filter !== 'object' || filter === null || !('q' in filter)) {
    return undefined
  }

  const q = (filter as { q?: unknown }).q
  return typeof q === 'string' && q.trim().length > 0 ? q.trim() : undefined
}

function readonlyMutation(): Promise<never> {
  return Promise.reject(new Error('This admin resource is read-only.'))
}

const rawDataProvider = {
  async getList(resource: string, params: ListParams) {
    if (resource !== 'users') {
      throw new Error(`Unknown resource: ${resource}`)
    }

    const page = params.pagination?.page ?? 1
    const perPage = params.pagination?.perPage ?? 25
    const search = searchFromFilter(params.filter)
    const query = new URLSearchParams({
      page: String(page),
      perPage: String(perPage),
    })

    if (search !== undefined) {
      query.set('search', search)
    }

    const response = await apiRequest<AdminUsersResponse>(`/admin/users?${query.toString()}`)
    return {
      data: response.users as RaRecord[],
      total: response.total,
    }
  },

  async getOne(resource: string, params: IdParams) {
    if (resource !== 'users') {
      throw new Error(`Unknown resource: ${resource}`)
    }

    const response = await apiRequest<{ user: AdminUserDetail }>(`/admin/users/${params.id}`)
    return { data: response.user as RaRecord }
  },

  async getMany(resource: string, params: ManyParams) {
    const users = await Promise.all(
      params.ids.map(async (id) => {
        const response = await apiRequest<{ user: AdminUserDetail }>(`/admin/${resource}/${id}`)
        return response.user
      }),
    )
    return { data: users as RaRecord[] }
  },

  async getManyReference() {
    return { data: [], total: 0 }
  },

  create: readonlyMutation,
  update: readonlyMutation,
  updateMany: readonlyMutation,
  delete: readonlyMutation,
  deleteMany: readonlyMutation,
}

export const dataProvider = rawDataProvider as DataProvider

export type { AdminUser, AdminUserDetail }
