import { describe, expect, it } from 'bun:test'
import { canBrowseParent, directoryEntriesOnly } from './folderPicker'

describe('folder picker helpers', () => {
  it('keeps only directory entries for step-by-step browsing', () => {
    expect(directoryEntriesOnly([
      { name: 'app', path: 'D:\\Code\\app', isDirectory: true },
      { name: 'README.md', path: 'D:\\Code\\README.md', isDirectory: false },
    ])).toEqual([
      { name: 'app', path: 'D:\\Code\\app', isDirectory: true },
    ])
  })

  it('shows parent navigation only when a parent path is different', () => {
    expect(canBrowseParent('D:\\Code\\app', 'D:\\Code')).toBe(true)
    expect(canBrowseParent('D:\\', 'D:\\')).toBe(false)
    expect(canBrowseParent('', 'D:\\')).toBe(false)
  })
})
