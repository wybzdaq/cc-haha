import { api } from './client'
import type { CurrentModelResponse, ModelsResponse } from '../types/model'

export const modelsApi = {
  list() {
    return api.get<ModelsResponse>('/api/models')
  },

  getCurrent() {
    return api.get<CurrentModelResponse>('/api/models/current')
  },

  setCurrent(modelId: string) {
    return api.put<{ ok: true; model: string }>('/api/models/current', { modelId })
  },
}
