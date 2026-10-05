import { nativeImage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { PdfRenderer } from './pdf-renderer'

const CACHE_VERSION = 2
const now = () => new Date().toISOString()

/** Main-process-only thumbnail cache. The renderer is handed data URLs, never paths. */
export class ThumbnailService {
  constructor(
    private readonly db: Database.Database,
    private readonly directory: string,
    private readonly assetPath: (relative: string) => string,
    private readonly pdfRenderer = new PdfRenderer()
  ) {
    mkdirSync(directory, { recursive: true })
  }

  get(assetId: string, width: number, height: number): string | null {
    const asset = this.db.prepare('SELECT sha256 FROM assets WHERE id=?').get(assetId) as
      { sha256: string | null } | undefined
    if (!asset?.sha256) return null
    const row = this.db
      .prepare(
        'SELECT relative_path,mime_type FROM asset_thumbnails WHERE asset_id=? AND source_sha256=? AND cache_version=? AND width=? AND height=?'
      )
      .get(assetId, asset.sha256, CACHE_VERSION, width, height) as
      { relative_path: string; mime_type: string } | undefined
    if (!row) return null
    const path = join(this.directory, row.relative_path)
    if (!existsSync(path)) {
      this.db
        .prepare(
          'DELETE FROM asset_thumbnails WHERE asset_id=? AND source_sha256=? AND cache_version=? AND width=? AND height=?'
        )
        .run(assetId, asset.sha256, CACHE_VERSION, width, height)
      return null
    }
    return `data:${row.mime_type};base64,${readFileSync(path).toString('base64')}`
  }

  async generate(
    assetId: string,
    width: number,
    height: number,
    cancelled: () => boolean
  ): Promise<Record<string, unknown>> {
    if (this.get(assetId, width, height)) return { assetId, cached: true }
    const asset = this.db.prepare('SELECT relative_path,mime_type,sha256 FROM assets WHERE id=?').get(assetId) as
      { relative_path: string; mime_type: string | null; sha256: string | null } | undefined
    if (!asset?.sha256) throw new Error('The requested asset is unavailable for thumbnailing.')
    if (cancelled()) throw new Error('Cancelled')
    if (!asset.mime_type?.startsWith('image/') && asset.mime_type !== 'application/pdf')
      throw new Error('Only image and PDF assets have thumbnails.')
    const png =
      asset.mime_type === 'application/pdf'
        ? await this.pdfRenderer.thumbnail(
            `data:application/pdf;base64,${readFileSync(this.assetPath(asset.relative_path)).toString('base64')}`,
            width,
            height
          )
        : (() => {
            const image = nativeImage.createFromPath(this.assetPath(asset.relative_path))
            if (image.isEmpty()) throw new Error('The image could not be decoded for thumbnailing.')
            const original = image.getSize()
            const scale = Math.min(1, width / original.width, height / original.height)
            return image
              .resize({
                width: Math.max(1, Math.round(original.width * scale)),
                height: Math.max(1, Math.round(original.height * scale)),
                quality: 'good'
              })
              .toPNG()
          })()
    if (cancelled()) throw new Error('Cancelled')
    const relative = `${assetId}-${asset.sha256.slice(0, 12)}-${CACHE_VERSION}-${width}x${height}.png`
    const destination = join(this.directory, relative)
    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, png)
      if (cancelled()) throw new Error('Cancelled')
      renameSync(temporary, destination)
      this.db.transaction(() => {
        this.db
          .prepare('DELETE FROM asset_thumbnails WHERE asset_id=? AND (source_sha256<>? OR cache_version<>?)')
          .run(assetId, asset.sha256, CACHE_VERSION)
        this.db
          .prepare(
            'INSERT OR REPLACE INTO asset_thumbnails (asset_id,source_sha256,cache_version,mime_type,relative_path,width,height,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
          )
          .run(assetId, asset.sha256, CACHE_VERSION, 'image/png', relative, width, height, now(), now())
      })()
      return { assetId, cached: false }
    } catch (error) {
      rmSync(temporary, { force: true })
      rmSync(destination, { force: true })
      throw error
    }
  }

  remove(assetId: string): void {
    const rows = this.db.prepare('SELECT relative_path FROM asset_thumbnails WHERE asset_id=?').all(assetId) as Array<{
      relative_path: string
    }>
    this.db.prepare('DELETE FROM asset_thumbnails WHERE asset_id=?').run(assetId)
    rows.forEach(({ relative_path }) => rmSync(join(this.directory, relative_path), { force: true }))
  }
}
