import type { RemoteFilesystemEntry } from '../api/filesystem'

export function directoryEntriesOnly(entries: RemoteFilesystemEntry[]) {
  return entries.filter((entry) => entry.isDirectory)
}

export function canBrowseParent(currentPath: string, parentPath: string) {
  const current = currentPath.trim()
  const parent = parentPath.trim()
  return current.length > 0 && parent.length > 0 && current !== parent
}
