import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { handleFilesystemRoute } from '../filesystem'

function browseUrl(targetPath: string, params?: Record<string, string>) {
  const url = new URL('http://127.0.0.1/api/filesystem/browse')
  url.searchParams.set('path', targetPath)
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value)
  }
  return url
}

function setupWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'filesystem-browse-'))
  mkdirSync(path.join(root, 'alpha', 'nested'), { recursive: true })
  mkdirSync(path.join(root, 'beta'))
  writeFileSync(path.join(root, 'root.txt'), 'root')
  writeFileSync(path.join(root, 'alpha', 'nested', 'child.txt'), 'nested')
  return root
}

describe('handleFilesystemRoute browse', () => {
  it('returns only the immediate child folders by default', async () => {
    const root = setupWorkspace()
    const res = await handleFilesystemRoute('/api/filesystem/browse', browseUrl(root))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.currentPath).toBe(path.resolve(root))
    expect(body.entries.map((entry: { name: string }) => entry.name)).toEqual(['alpha', 'beta'])
    expect(body.entries.some((entry: { name: string }) => entry.name === 'nested')).toBe(false)
    expect(body.entries.some((entry: { name: string }) => entry.name === 'root.txt')).toBe(false)
  })

  it('includes immediate files only when requested', async () => {
    const root = setupWorkspace()
    const res = await handleFilesystemRoute('/api/filesystem/browse', browseUrl(root, { includeFiles: 'true' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.entries.map((entry: { name: string }) => entry.name)).toEqual(['alpha', 'beta', 'root.txt'])
    expect(body.entries.some((entry: { name: string }) => entry.name === 'child.txt')).toBe(false)
  })
})
