import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, posix } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ExportFormat, ExportResult, ExportScope } from '../../shared/domain'
import { blockTypes, relationTypes } from '../../shared/domain'
import { PdfRenderer } from './pdf-renderer'

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const safe = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'export'
export type ScopeData = {
  notebook: Record<string, unknown>
  pages: Array<Record<string, unknown>>
  notes: Array<Record<string, unknown>>
  blocks: Array<Record<string, unknown>>
  assets: Array<Record<string, unknown>>
  relations: Array<Record<string, unknown>>
  runs: Array<Record<string, unknown>>
  segments: Array<Record<string, unknown>>
  sources: Array<Record<string, unknown>>
  blockSources: Array<Record<string, unknown>>
}

const uuid = (id: unknown) =>
  typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
/** Validate an untrusted v1 archive before copying a byte or changing SQLite. */
export function validateLosslessArchive(archive: Record<string, any>, root: string): void {
  const lists = ['pages', 'notes', 'blocks', 'assets', 'relations', 'runs', 'segments', 'sources', 'blockSources']
  if (archive.schemaVersion !== 1 || !archive.notebook || lists.some((k) => !Array.isArray(archive[k])))
    throw new Error('This archive has an unsupported or invalid lossless schema version.')
  const every = [archive.notebook, ...lists.flatMap((k) => archive[k])]
  if (every.some((x) => !x || typeof x !== 'object' || !uuid(x.id)))
    throw new Error('The archive contains invalid record identifiers.')
  if (new Set(every.map((x) => x.id)).size !== every.length)
    throw new Error('The archive contains duplicate identifiers.')
  const ids = (key: string) => new Set(archive[key].map((x: any) => x.id))
  const pages = ids('pages'),
    notes = ids('notes'),
    blocks = ids('blocks'),
    assets = ids('assets'),
    runs = ids('runs'),
    sources = ids('sources')
  const json = (value: unknown) => {
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    } catch {
      return false
    }
  }
  if (
    !json(archive.notebook.metadata_json ?? {}) ||
    archive.pages.some((x: any) => x.notebook_id !== archive.notebook.id) ||
    archive.notes.some((x: any) => !pages.has(x.page_id)) ||
    archive.blocks.some(
      (x: any) => !notes.has(x.note_id) || !blockTypes.includes(x.type) || !json(x.data_json) || !json(x.metadata_json)
    ) ||
    archive.relations.some(
      (x: any) => !blocks.has(x.from_block_id) || !blocks.has(x.to_block_id) || !relationTypes.includes(x.relation_type)
    ) ||
    archive.runs.some((x: any) => !blocks.has(x.block_id) || !assets.has(x.asset_id)) ||
    archive.segments.some((x: any) => !runs.has(x.run_id)) ||
    archive.sources.some((x: any) => !assets.has(x.asset_id) || x.source_type !== 'pdf') ||
    archive.blockSources.some((x: any) => !blocks.has(x.block_id) || !sources.has(x.source_document_id))
  )
    throw new Error('The archive has a broken hierarchy or malformed record.')
  for (const [key, parent] of [
    ['pages', 'notebook_id'],
    ['notes', 'page_id'],
    ['blocks', 'note_id'],
    ['segments', 'run_id']
  ] as const) {
    const groups = new Map<string, number[]>()
    archive[key].forEach((x: any) =>
      groups.set(String(x[parent]), [...(groups.get(String(x[parent])) ?? []), x.position])
    )
    if (
      [...groups.values()].some(
        (v) =>
          !v.every(Number.isInteger) ||
          new Set(v).size !== v.length ||
          [...v].sort((a, b) => a - b).some((n, i) => n !== i)
      )
    )
      throw new Error('The archive has invalid hierarchy ordering.')
  }
  for (const asset of archive.assets) {
    if (
      !['image', 'screenshot', 'audio', 'file'].includes(asset.kind) ||
      typeof asset.exportPath !== 'string' ||
      asset.exportPath.includes('\\') ||
      asset.exportPath.startsWith('/') ||
      asset.exportPath.split('/').some((part: string) => !part || part === '.' || part === '..') ||
      !asset.exportPath.startsWith('assets/') ||
      !/^[a-f0-9]{64}$/i.test(asset.sha256 ?? '')
    )
      throw new Error('The archive contains an unsafe asset path or checksum.')
    const source = join(root, ...asset.exportPath.split('/'))
    if (!existsSync(source) || createHash('sha256').update(readFileSync(source)).digest('hex') !== asset.sha256)
      throw new Error('An archive asset failed its integrity check.')
  }
}

export class ExportService {
  constructor(
    private readonly db: Database.Database,
    private readonly assetPath: (relative: string) => string
  ) {}
  start(scope: ExportScope, format: ExportFormat, destination: string, renderedPdf?: Buffer): ExportResult {
    const data = this.readScope(scope)
    // An archive contains only the selected active rows, whose live positions may have gaps.
    for (const [records, parent] of [
      [data.pages, 'notebook_id'],
      [data.notes, 'page_id'],
      [data.blocks, 'note_id']
    ] as const) {
      const next = new Map<string, number>()
      for (const row of records) {
        const key = String(row[parent])
        row.position = next.get(key) ?? 0
        next.set(key, Number(row.position) + 1)
      }
    }
    const id = randomUUID()
    const rootName = `${safe(String(data.notebook.title))}-${stamp()}`
    const staging = join(destination, `.${rootName}-${id}.tmp`)
    const final = join(destination, rootName)
    let published = false
    mkdirSync(staging, { recursive: true })
    try {
      const assetsDirectory = join(staging, 'assets')
      mkdirSync(assetsDirectory, { recursive: true })
      for (const asset of data.assets) {
        const relative = String(asset.relative_path)
        if (
          relative.includes('\\') ||
          relative.startsWith('/') ||
          relative.split('/').includes('..') ||
          !existsSync(this.assetPath(relative))
        )
          throw new Error('An exported asset is missing or has an unsafe path.')
        const filename = `${asset.id}-${basename(relative)}`
        const target = join(assetsDirectory, filename)
        copyFileSync(this.assetPath(relative), target)
        asset.exportPath = posix.join('assets', filename)
        asset.sha256 = createHash('sha256').update(readFileSync(target)).digest('hex')
      }
      const manifest = { schemaVersion: 1, exportedAt: new Date().toISOString(), scope, format, ...data }
      if (format === 'lossless-json')
        writeFileSync(join(staging, 'notebook.lossless.v1.json'), JSON.stringify(manifest, null, 2))
      else if (format === 'pdf') {
        if (!renderedPdf) throw new Error('PDF export must be rendered by the hidden print renderer.')
        writeFileSync(join(staging, 'notebook.pdf'), renderedPdf)
      } else writeFileSync(join(staging, 'notebook.md'), this.markdown(data, format === 'ai-context'))
      writeFileSync(
        join(staging, 'manifest.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            id,
            format,
            scope,
            assets: data.assets.map((asset) => ({ id: asset.id, path: asset.exportPath }))
          },
          null,
          2
        )
      )
      renameSync(staging, final)
      published = true
      this.db.transaction(() => {
        this.db
          .prepare(
            'INSERT INTO export_records (id, notebook_id, scope_type, scope_id, format, relative_path, manifest_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            id,
            data.notebook.id,
            scope.type,
            this.scopeId(scope),
            format,
            basename(final),
            JSON.stringify({ schemaVersion: 1 }),
            new Date().toISOString()
          )
        const reference = this.db.prepare('INSERT INTO export_asset_references (export_id, asset_id) VALUES (?, ?)')
        data.assets.forEach((asset) => reference.run(id, asset.id))
      })()
      return { id, directory: final, format, manifestPath: join(final, 'manifest.json') }
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      // A database failure after publication must not leave an untracked
      // export that looks complete to a user or a later recovery process.
      if (published) rmSync(final, { recursive: true, force: true })
      throw error
    }
  }
  printableDocument(scope: ExportScope): string {
    const data = this.readScope(scope)
    const blocksByNote = new Map<string, Array<Record<string, unknown>>>()
    data.blocks.forEach((block) =>
      blocksByNote.set(String(block.note_id), [...(blocksByNote.get(String(block.note_id)) ?? []), block])
    )
    const pages = new Map(data.pages.map((page) => [String(page.id), page.title]))
    const assets = new Map(data.assets.map((asset) => [String(asset.id), asset]))
    let html = `<h1>${PdfRenderer.text(data.notebook.title)}</h1>`
    for (const note of data.notes) {
      html += `<section><h2>${PdfRenderer.text(pages.get(String(note.page_id)) ?? 'Page')}</h2><h3>${PdfRenderer.text(note.title)}</h3>`
      for (const block of blocksByNote.get(String(note.id)) ?? []) {
        const payload = JSON.parse(String(block.data_json ?? '{}')) as Record<string, unknown>
        const type = String(block.type)
        html += `<div class="label">${PdfRenderer.text(type)}</div>`
        if (typeof payload.text === 'string') html += `<p>${PdfRenderer.text(payload.text).replace(/\n/g, '<br>')}</p>`
        if (typeof payload.assetId === 'string') {
          const asset = assets.get(payload.assetId)
          if (asset) {
            const path = this.assetPath(String(asset.relative_path))
            if (existsSync(path) && String(asset.mime_type ?? '').startsWith('image/'))
              html += `<img alt="${PdfRenderer.text(payload.filename ?? 'Notebook image')}" src="data:${PdfRenderer.text(asset.mime_type)};base64,${readFileSync(path).toString('base64')}">`
            else html += `<p>Asset: ${PdfRenderer.text(payload.filename ?? type)}</p>`
          }
        }
        if (type === 'audio') {
          const run = data.runs.find((entry) => entry.id === payload.activeTranscriptionRunId)
          if (run?.transcript_text)
            html += `<h4>Transcription</h4><p>${PdfRenderer.text(run.transcript_text).replace(/\n/g, '<br>')}</p>`
        }
      }
      html += '</section>'
    }
    return html
  }
  private readScope(scope: ExportScope): ScopeData {
    const scopeId = this.scopeId(scope)
    const notebookId =
      scope.type === 'notebook'
        ? scope.notebookId
        : (
            this.db
              .prepare(
                scope.type === 'page'
                  ? 'SELECT notebook_id FROM pages WHERE id = ?'
                  : 'SELECT p.notebook_id FROM notes n JOIN pages p ON p.id = n.page_id WHERE n.id = ?'
              )
              .get(scopeId) as { notebook_id?: string } | undefined
          )?.notebook_id
    if (!notebookId) throw new Error('The requested export scope does not exist.')
    const notebook = this.db.prepare('SELECT * FROM notebooks WHERE id = ? AND deleted_at IS NULL').get(notebookId) as
      Record<string, unknown> | undefined
    if (!notebook) throw new Error('The requested export scope is in Trash.')
    const pageWhere =
      scope.type === 'page'
        ? 'p.id = ?'
        : scope.type === 'note'
          ? 'p.id = (SELECT page_id FROM notes WHERE id = ?)'
          : 'p.notebook_id = ?'
    const pages = this.db
      .prepare(`SELECT p.* FROM pages p WHERE ${pageWhere} AND p.deleted_at IS NULL ORDER BY p.position`)
      .all(scopeId) as Array<Record<string, unknown>>
    const notes = this.db
      .prepare(
        `SELECT n.* FROM notes n JOIN pages p ON p.id=n.page_id WHERE p.notebook_id=? AND n.deleted_at IS NULL ${scope.type === 'note' ? 'AND n.id=?' : scope.type === 'page' ? 'AND n.page_id=?' : ''} ORDER BY n.page_id,n.position`
      )
      .all(...(scope.type === 'notebook' ? [notebookId] : [notebookId, scopeId])) as Array<Record<string, unknown>>
    const noteIds = notes.map((n) => String(n.id))
    if (!noteIds.length)
      return {
        notebook,
        pages,
        notes,
        blocks: [],
        assets: [],
        relations: [],
        runs: [],
        segments: [],
        sources: [],
        blockSources: []
      }
    const marks = noteIds.map(() => '?').join(',')
    const blocks = this.db
      .prepare(`SELECT * FROM blocks WHERE note_id IN (${marks}) AND deleted_at IS NULL ORDER BY note_id,position`)
      .all(...noteIds) as Array<Record<string, unknown>>
    const blockIds = blocks.map((b) => String(b.id))
    if (!blockIds.length)
      return {
        notebook,
        pages,
        notes,
        blocks,
        assets: [],
        relations: [],
        runs: [],
        segments: [],
        sources: [],
        blockSources: []
      }
    const blockMarks = blockIds.map(() => '?').join(',')
    const assets = this.db
      .prepare(
        `SELECT DISTINCT a.* FROM assets a JOIN asset_references ar ON ar.asset_id=a.id WHERE ar.block_id IN (${blockMarks})`
      )
      .all(...blockIds) as Array<Record<string, unknown>>
    const relations = this.db
      .prepare(
        `SELECT * FROM block_relations WHERE from_block_id IN (${blockMarks}) AND to_block_id IN (${blockMarks}) ORDER BY created_at`
      )
      .all(...blockIds, ...blockIds) as Array<Record<string, unknown>>
    const runs = this.db
      .prepare(`SELECT * FROM transcription_runs WHERE block_id IN (${blockMarks}) ORDER BY created_at`)
      .all(...blockIds) as Array<Record<string, unknown>>
    const runIds = runs.map((r) => String(r.id))
    const segments = runIds.length
      ? (this.db
          .prepare(
            `SELECT * FROM transcription_segments WHERE run_id IN (${runIds.map(() => '?').join(',')}) ORDER BY run_id,position`
          )
          .all(...runIds) as Array<Record<string, unknown>>)
      : []
    const blockSources = this.db
      .prepare(`SELECT * FROM block_sources WHERE block_id IN (${blockMarks}) ORDER BY created_at`)
      .all(...blockIds) as Array<Record<string, unknown>>
    const sourceIds = [...new Set(blockSources.map((item) => String(item.source_document_id)))]
    const sources = sourceIds.length
      ? (this.db
          .prepare(`SELECT * FROM source_documents WHERE id IN (${sourceIds.map(() => '?').join(',')})`)
          .all(...sourceIds) as Array<Record<string, unknown>>)
      : []
    const sourceAssetIds = sources.map((source) => String(source.asset_id)).filter(Boolean)
    if (sourceAssetIds.length) {
      const extra = this.db
        .prepare(`SELECT * FROM assets WHERE id IN (${sourceAssetIds.map(() => '?').join(',')})`)
        .all(...sourceAssetIds) as Array<Record<string, unknown>>
      const seen = new Set(assets.map((asset) => String(asset.id)))
      extra.forEach((asset) => {
        if (!seen.has(String(asset.id))) assets.push(asset)
      })
    }
    return { notebook, pages, notes, blocks, assets, relations, runs, segments, sources, blockSources }
  }
  private markdown(data: ScopeData, semantic: boolean): string {
    const blocksByNote = new Map<string, Array<Record<string, unknown>>>()
    data.blocks.forEach((block) => {
      const list = blocksByNote.get(String(block.note_id)) ?? []
      list.push(block)
      blocksByNote.set(String(block.note_id), list)
    })
    const pageNames = new Map(data.pages.map((page) => [String(page.id), String(page.title)]))
    let output = `# ${data.notebook.title}\n\n`
    for (const note of data.notes) {
      output += `## ${pageNames.get(String(note.page_id)) ?? 'Page'} / ${note.title}\n\n`
      for (const block of blocksByNote.get(String(note.id)) ?? []) {
        const type = String(block.type)
        const payload = JSON.parse(String(block.data_json ?? '{}')) as Record<string, unknown>
        const label = semantic ? `[${type === 'source_text' ? 'SOURCE' : type.toUpperCase()}] ` : ''
        if (typeof payload.text === 'string') output += `${label}${payload.text}\n\n`
        else if (typeof payload.assetId === 'string') {
          const asset = data.assets.find((item) => item.id === payload.assetId)
          output += `${label}[${payload.filename ?? type}](${asset?.exportPath ?? 'assets/missing'})\n\n`
          if (type === 'audio') {
            const run = data.runs.find((item) => item.id === payload.activeTranscriptionRunId)
            if (run?.transcript_text)
              output += `${semantic ? '[AUDIO TRANSCRIPT] ' : 'Transcript: '}${run.transcript_text}\n\n`
          }
        }
      }
    }
    return output
  }
  private scopeId(scope: ExportScope): string {
    return scope.type === 'notebook' ? scope.notebookId : scope.type === 'page' ? scope.pageId : scope.noteId
  }
}
