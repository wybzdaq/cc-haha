import { api } from './client'
import type {
  PluginDetail,
  PluginListResponse,
  PluginMarketListResponse,
  PluginReloadSummary,
  PluginSessionReloadSummary,
  PluginScope,
} from '../types/plugin'

type PluginActionPayload = {
  id: string
  scope?: PluginScope
  keepData?: boolean
}

export const pluginsApi = {
  list: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<PluginListResponse>(`/api/plugins${query}`)
  },

  market: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<PluginMarketListResponse>(`/api/plugins/market${query}`, { timeout: 120_000 })
  },

  detail: (id: string, cwd?: string) => {
    const query = new URLSearchParams({ id })
    if (cwd) query.set('cwd', cwd)
    return api.get<{ detail: PluginDetail }>(`/api/plugins/detail?${query.toString()}`)
  },

  enable: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/enable', payload),

  install: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>(
      '/api/plugins/install',
      payload,
      { timeout: 120_000 },
    ),

  disable: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/disable', payload),

  update: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/update', payload),

  uninstall: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/api/plugins/uninstall', payload),

  reload: (cwd?: string, sessionId?: string) => {
    const query = new URLSearchParams()
    if (cwd) query.set('cwd', cwd)
    if (sessionId) query.set('sessionId', sessionId)
    const suffix = query.size > 0 ? `?${query.toString()}` : ''
    return api.post<{
      ok: true
      summary: PluginReloadSummary
      session?: PluginSessionReloadSummary
    }>(
      `/api/plugins/reload${suffix}`,
      undefined,
      { timeout: 120_000 },
    )
  },
}
