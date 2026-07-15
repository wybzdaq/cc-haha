import { api } from './client'

export type RemoteFilesystemEntry = {
  name: string
  path: string
  isDirectory: boolean
  relativePath?: string
}

export type RemoteDirectoryListing = {
  currentPath: string
  parentPath: string
  entries: RemoteFilesystemEntry[]
}

export const filesystemApi = {
  browse(path?: string) {
    const query = new URLSearchParams()
    const trimmedPath = path?.trim()
    if (trimmedPath) query.set('path', trimmedPath)
    const qs = query.toString()
    return api.get<RemoteDirectoryListing>(`/api/filesystem/browse${qs ? `?${qs}` : ''}`)
  },
}
