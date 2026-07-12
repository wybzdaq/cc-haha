import { create } from 'zustand'
import { pluginsApi } from '../api/plugins'
import type {
  PluginDetail,
  PluginListResponse,
  PluginMarketEntry,
  PluginMarketListResponse,
  PluginReloadSummary,
  PluginScope,
  PluginSummary,
} from '../types/plugin'

type PluginStore = {
  plugins: PluginSummary[]
  marketplaces: PluginListResponse['marketplaces']
  summary: PluginListResponse['summary'] | null
  marketPlugins: PluginMarketEntry[]
  marketSummary: PluginMarketListResponse['summary'] | null
  marketFailures: PluginMarketListResponse['failures']
  selectedPlugin: PluginDetail | null
  lastReloadSummary: PluginReloadSummary | null
  isLoading: boolean
  isMarketLoading: boolean
  isDetailLoading: boolean
  isApplying: boolean
  error: string | null
  marketError: string | null
  fetchPlugins: (cwd?: string) => Promise<void>
  fetchPluginMarket: (cwd?: string) => Promise<void>
  fetchPluginDetail: (id: string, cwd?: string) => Promise<void>
  reloadPlugins: (cwd?: string, sessionId?: string) => Promise<PluginReloadSummary>
  installPlugin: (id: string, scope?: PluginScope, cwd?: string, sessionId?: string) => Promise<string>
  enablePlugin: (id: string, scope?: PluginScope, cwd?: string, sessionId?: string) => Promise<string>
  disablePlugin: (id: string, scope?: PluginScope, cwd?: string, sessionId?: string) => Promise<string>
  bulkEnablePlugins: (plugins: PluginActionTarget[], cwd?: string, sessionId?: string) => Promise<number>
  bulkDisablePlugins: (plugins: PluginActionTarget[], cwd?: string, sessionId?: string) => Promise<number>
  updatePlugin: (id: string, scope?: PluginScope, cwd?: string, sessionId?: string) => Promise<string>
  uninstallPlugin: (id: string, scope?: PluginScope, keepData?: boolean, cwd?: string, sessionId?: string) => Promise<string>
  clearSelection: () => void
}

export type PluginActionTarget = {
  id: string
  scope?: PluginScope
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  plugins: [],
  marketplaces: [],
  summary: null,
  marketPlugins: [],
  marketSummary: null,
  marketFailures: [],
  selectedPlugin: null,
  lastReloadSummary: null,
  isLoading: false,
  isMarketLoading: false,
  isDetailLoading: false,
  isApplying: false,
  error: null,
  marketError: null,

  fetchPlugins: async (cwd) => {
    set({ isLoading: true, error: null })
    try {
      const data = await pluginsApi.list(cwd)
      set({
        plugins: data.plugins,
        marketplaces: data.marketplaces,
        summary: data.summary,
        isLoading: false,
      })
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  fetchPluginMarket: async (cwd) => {
    set({ isMarketLoading: true, marketError: null })
    try {
      const data = await pluginsApi.market(cwd)
      set({
        marketPlugins: data.plugins,
        marketSummary: data.summary,
        marketFailures: data.failures,
        isMarketLoading: false,
      })
    } catch (err) {
      set({
        isMarketLoading: false,
        marketError: err instanceof Error ? err.message : String(err),
      })
    }
  },

  fetchPluginDetail: async (id, cwd) => {
    set({ isDetailLoading: true, error: null })
    try {
      const { detail } = await pluginsApi.detail(id, cwd)
      set({ selectedPlugin: detail, isDetailLoading: false })
    } catch (err) {
      set({
        isDetailLoading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  reloadPlugins: async (cwd, sessionId) => {
    set({ isApplying: true, error: null })
    try {
      const { summary } = await pluginsApi.reload(cwd, sessionId)
      await get().fetchPlugins(cwd)
      const selected = get().selectedPlugin
      if (selected) {
        await get().fetchPluginDetail(selected.id, cwd)
      }
      set({ isApplying: false, lastReloadSummary: summary })
      return summary
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ isApplying: false, error: message })
      throw err
    }
  },

  installPlugin: async (id, scope, cwd, sessionId) => {
    return runAction(
      () => pluginsApi.install({ id, scope }),
      set,
      get,
      cwd,
      sessionId,
      false,
      true,
    )
  },

  enablePlugin: async (id, scope, cwd, sessionId) => {
    return runAction(
      () => pluginsApi.enable({ id, scope }),
      set,
      get,
      cwd,
      sessionId,
    )
  },

  disablePlugin: async (id, scope, cwd, sessionId) => {
    return runAction(
      () => pluginsApi.disable({ id, scope }),
      set,
      get,
      cwd,
      sessionId,
    )
  },

  bulkEnablePlugins: async (plugins, cwd, sessionId) => {
    return runBulkAction(
      plugins,
      (plugin) => pluginsApi.enable(plugin),
      set,
      get,
      cwd,
      sessionId,
    )
  },

  bulkDisablePlugins: async (plugins, cwd, sessionId) => {
    return runBulkAction(
      plugins,
      (plugin) => pluginsApi.disable(plugin),
      set,
      get,
      cwd,
      sessionId,
    )
  },

  updatePlugin: async (id, scope, cwd, sessionId) => {
    return runAction(
      () => pluginsApi.update({ id, scope }),
      set,
      get,
      cwd,
      sessionId,
    )
  },

  uninstallPlugin: async (id, scope, keepData = false, cwd, sessionId) => {
    return runAction(
      () => pluginsApi.uninstall({ id, scope, keepData }),
      set,
      get,
      cwd,
      sessionId,
      true,
    )
  },

  clearSelection: () => set({ selectedPlugin: null }),
}))

async function runAction(
  action: () => Promise<{ ok: true; message: string }>,
  set: (updater: Partial<PluginStore>) => void,
  get: () => PluginStore,
  cwd?: string,
  sessionId?: string,
  clearSelection = false,
  refreshMarket = false,
): Promise<string> {
  set({ isApplying: true, error: null })
  try {
    const { message } = await action()
    const { summary } = await pluginsApi.reload(cwd, sessionId)
    await get().fetchPlugins(cwd)
    if (refreshMarket) {
      await get().fetchPluginMarket(cwd)
    }
    const selected = get().selectedPlugin
    if (clearSelection) {
      set({ selectedPlugin: null })
    } else if (selected) {
      await get().fetchPluginDetail(selected.id, cwd)
    }
    set({ isApplying: false, lastReloadSummary: summary })
    return message
  } catch (err) {
    set({
      isApplying: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

async function runBulkAction(
  plugins: PluginActionTarget[],
  action: (plugin: PluginActionTarget) => Promise<{ ok: true; message: string }>,
  set: (updater: Partial<PluginStore>) => void,
  get: () => PluginStore,
  cwd?: string,
  sessionId?: string,
): Promise<number> {
  if (plugins.length === 0) return 0

  set({ isApplying: true, error: null })
  try {
    for (const plugin of plugins) {
      await action(plugin)
    }

    const { summary } = await pluginsApi.reload(cwd, sessionId)
    await get().fetchPlugins(cwd)
    const selected = get().selectedPlugin
    if (selected) {
      await get().fetchPluginDetail(selected.id, cwd)
    }
    set({ isApplying: false, lastReloadSummary: summary })
    return plugins.length
  } catch (err) {
    set({
      isApplying: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}
