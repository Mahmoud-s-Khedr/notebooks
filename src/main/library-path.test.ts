import { describe, expect, it } from 'vitest'
import { win32, posix, join } from 'node:path'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { directoryContains, physicalPath } from './library-path'

describe('library path restrictions', () => {
  it('rejects descendants and accepts sibling prefixes on Linux and Windows', () => {
    expect(directoryContains('/data/library', '/data/library/assets', posix)).toBe(true)
    expect(directoryContains('/data/library', '/data/library-copy', posix)).toBe(false)
    expect(directoryContains('C:\\Data\\Library', 'c:\\data\\library\\assets', win32)).toBe(true)
    expect(directoryContains('C:\\Data\\Library', 'C:\\Data\\Library-copy', win32)).toBe(false)
    expect(directoryContains('C:\\Data\\Library', 'D:\\Data\\Library', win32)).toBe(false)
  })
  it('accepts resolved archive assets and rejects escapes on both platforms', () => {
    for (const [paths, root] of [
      [posix, '/archive'],
      [win32, 'C:\\archive']
    ] as const) {
      expect(directoryContains(root, paths.resolve(root, 'assets/image.png'), paths)).toBe(true)
      expect(directoryContains(root, paths.resolve(root, 'assets/nested/file.wav'), paths)).toBe(true)
      expect(directoryContains(root, paths.resolve(root, '../archive-copy/file.png'), paths)).toBe(false)
      expect(directoryContains(root, paths.resolve(root, '../outside.png'), paths)).toBe(false)
    }
    expect(directoryContains('C:\\archive', 'D:\\archive\\assets\\image.png', win32)).toBe(false)
  })
  it('recognizes a chooser alias even before its destination subfolder exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'notebook-path-'))
    try {
      const library = join(root, 'library')
      mkdirSync(library)
      const alias = join(root, 'alias')
      symlinkSync(library, alias, process.platform === 'win32' ? 'junction' : 'dir')
      expect(directoryContains(physicalPath(library), physicalPath(join(alias, 'new-folder')))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
