export type ModelInfo = {
  id: string
  name: string
  description: string
  context: string
}

export type ModelsResponse = {
  models: ModelInfo[]
  provider: {
    id: string
    name: string
  } | null
}

export type CurrentModelResponse = {
  model: ModelInfo
}
