import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  nativeImage: { createFromPath: vi.fn() }
}))

import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { TestLibrary, writeFixture } from '../test-support'
import { ThumbnailService } from './thumbnail-service'

describe('ThumbnailService managed cache safety', () => {
  const libraries: TestLibrary[] = []
  afterEach(() => libraries.splice(0).forEach((library) => library.close()))

  it('caches successful PDF rendering, removes stale entries, and never writes unsupported or cancelled work', async () => {
    const library = new TestLibrary()
    libraries.push(library)
    const notebook = library.service.createNotebook('Thumbs')
    const pdf = library.service.importAsset(
      notebook.id,
      'file',
      writeFixture(library.root, 'paper.pdf', '%PDF fixture')
    )
    const renderer = { thumbnail: vi.fn(async () => Buffer.from('png-bytes')) }
    const directory = join(library.assets, '.thumb-test')
    const thumbnails = new ThumbnailService(
      library.database.connection,
      directory,
      (relative) => join(library.assets, relative.replace(/^assets\//, '')),
      renderer as any
    )
    expect(await thumbnails.generate(pdf.id, 120, 80, () => false)).toEqual({ assetId: pdf.id, cached: false })
    expect(await thumbnails.generate(pdf.id, 120, 80, () => false)).toEqual({ assetId: pdf.id, cached: true })
    expect(renderer.thumbnail).toHaveBeenCalledTimes(1)
    const row = library.database.connection
      .prepare('SELECT relative_path FROM asset_thumbnails WHERE asset_id=?')
      .get(pdf.id) as { relative_path: string }
    rmSync(join(directory, row.relative_path))
    expect(thumbnails.get(pdf.id, 120, 80)).toBeNull()
    expect(
      library.database.connection.prepare('SELECT * FROM asset_thumbnails WHERE asset_id=?').get(pdf.id)
    ).toBeUndefined()

    expect(await thumbnails.generate(pdf.id, 120, 80, () => true).catch((error: Error) => error.message)).toBe(
      'Cancelled'
    )
    const text = library.service.importAsset(
      notebook.id,
      'file',
      writeFixture(library.root, 'note.txt', 'not an image')
    )
    await expect(thumbnails.generate(text.id, 120, 80, () => false)).rejects.toThrow('Only image and PDF')
    expect(readdirSync(directory)).toEqual([])
  })

  it('cleans temporary output when a PDF renderer fails', async () => {
    const library = new TestLibrary()
    libraries.push(library)
    const notebook = library.service.createNotebook('Thumb failure')
    const pdf = library.service.importAsset(
      notebook.id,
      'file',
      writeFixture(library.root, 'broken.pdf', '%PDF fixture')
    )
    const directory = join(library.assets, '.thumb-failure')
    const thumbnails = new ThumbnailService(
      library.database.connection,
      directory,
      (relative) => join(library.assets, relative.replace(/^assets\//, '')),
      { thumbnail: async () => Promise.reject(new Error('renderer failed /private/input.pdf token=secret')) } as any
    )
    await expect(thumbnails.generate(pdf.id, 64, 64, () => false)).rejects.toThrow('renderer failed')
    expect(readdirSync(directory)).toEqual([])
    expect(
      library.database.connection.prepare('SELECT * FROM asset_thumbnails WHERE asset_id=?').get(pdf.id)
    ).toBeUndefined()
  })
})
