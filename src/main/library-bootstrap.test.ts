import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveLibraryBootstrap } from './library-bootstrap'

describe('library bootstrap pointer recovery', () => {
  const directories: string[] = []
  afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

  it('falls back to the default library for missing, malformed, or interrupted pointers', () => {
    const root = mkdtempSync(join(tmpdir(), 'research-notebook-bootstrap-'))
    directories.push(root)
    const pointer = join(root, 'library-bootstrap.json')
    expect(resolveLibraryBootstrap(root, pointer)).toEqual({ activeRoot: root, previousRoot: null })
    writeFileSync(pointer, '{not json')
    expect(resolveLibraryBootstrap(root, pointer)).toEqual({ activeRoot: root, previousRoot: null })
    writeFileSync(pointer, JSON.stringify({ activeRoot: join(root, 'missing') }))
    expect(resolveLibraryBootstrap(root, pointer)).toEqual({ activeRoot: root, previousRoot: null })
  })

  it('recognizes only a complete relocated library', () => {
    const root = mkdtempSync(join(tmpdir(), 'research-notebook-bootstrap-'))
    directories.push(root)
    const relocated = join(root, 'relocated')
    mkdirSync(relocated)
    writeFileSync(join(relocated, 'database.sqlite'), '')
    const pointer = join(root, 'library-bootstrap.json')
    writeFileSync(pointer, JSON.stringify({ activeRoot: relocated, previousRoot: join(root, 'old') }))
    expect(resolveLibraryBootstrap(root, pointer)).toEqual({ activeRoot: relocated, previousRoot: join(root, 'old') })
  })
})
