import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, posix } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ExportFormat, ExportResult, ExportScope } from '../../shared/domain'
import { blockTypes, relationTypes } from '../../shared/domain'
import { directoryContains, physicalPath } from '../library-path'
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
  relationshipTargets?: Array<{
    fromBlockId: string
    relationType: string
    targetId: string
    targetText: string
    noteTitle: string
    pageTitle: string
  }>
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
      [...groups.values()].some((v) => !v.every((n) => Number.isInteger(n) && n >= 0) || new Set(v).size !== v.length)
    )
      throw new Error('The archive has invalid hierarchy ordering.')
  }
  for (const block of archive.blocks) {
    const data = typeof block.data_json === 'string' ? JSON.parse(block.data_json) : block.data_json
    if (data.transcriptReviews !== undefined) {
      if (
        !data.transcriptReviews ||
        typeof data.transcriptReviews !== 'object' ||
        Array.isArray(data.transcriptReviews)
      )
        throw new Error('The archive contains invalid transcript reviews.')
      for (const [id, review] of Object.entries(data.transcriptReviews) as [string, any][]) {
        if (
          !archive.runs.some((run: any) => run.id === id && run.block_id === block.id) ||
          typeof review?.text !== 'string'
        )
          throw new Error('The archive contains invalid transcript reviews.')
      }
    }
  }
  for (const source of archive.blockSources) {
    if (!source.bounds_json) continue
    let bounds: any
    try {
      bounds = typeof source.bounds_json === 'string' ? JSON.parse(source.bounds_json) : source.bounds_json
    } catch {
      throw new Error('The archive contains invalid source bounds.')
    }
    if (
      ![bounds?.x, bounds?.y, bounds?.width, bounds?.height].every(Number.isFinite) ||
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      (bounds.coordinateSpace !== undefined && bounds.coordinateSpace !== 'pdf-points-bottom-left')
    )
      throw new Error('The archive contains invalid source bounds.')
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
    if (
      !directoryContains(physicalPath(root), physicalPath(source)) ||
      !existsSync(source) ||
      createHash('sha256').update(readFileSync(source)).digest('hex') !== asset.sha256
    )
      throw new Error('An archive asset failed its integrity check.')
  }
}

export class ExportService {
  constructor(
    private readonly db: Database.Database,
    private readonly assetPath: (relative: string) => string
  ) {}
  start(
    scope: ExportScope,
    format: ExportFormat,
    destination: string,
    renderedPdf?: Buffer,
    snapshot?: ScopeData
  ): ExportResult {
    const data = structuredClone(snapshot ?? this.snapshot(scope))
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
        const hash = createHash('sha256').update(readFileSync(target)).digest('hex')
        if (asset.sha256 && hash !== asset.sha256) throw new Error('An exported asset failed its integrity check.')
        asset.sha256 = hash
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
  snapshot(scope: ExportScope): ScopeData {
    return this.db.transaction(() => this.readScope(scope))()
  }
  stageSnapshot(data: ScopeData, directory: string): ExportService {
    mkdirSync(directory, { recursive: true })
    for (const asset of data.assets) {
      const source = this.assetPath(String(asset.relative_path))
      const target = join(directory, String(asset.id))
      copyFileSync(source, target)
      const hash = createHash('sha256').update(readFileSync(target)).digest('hex')
      if (asset.sha256 && hash !== asset.sha256) throw new Error('An exported asset failed its integrity check.')
    }
    return new ExportService(this.db, (relative) => {
      const asset = data.assets.find((a) => a.relative_path === relative)
      if (!asset) throw new Error('Asset is outside the export snapshot.')
      return join(directory, String(asset.id))
    })
  }
  printableDocument(scope: ExportScope, snapshot?: ScopeData): string {
    const data = snapshot ?? this.snapshot(scope)
    const blocksByNote = new Map<string, Array<Record<string, unknown>>>()
    data.blocks.forEach((block) =>
      blocksByNote.set(String(block.note_id), [...(blocksByNote.get(String(block.note_id)) ?? []), block])
    )
    const pages = new Map(data.pages.map((page) => [String(page.id), page.title]))
    const assets = new Map(data.assets.map((asset) => [String(asset.id), asset]))
    let html = `<title>${PdfRenderer.text(String(data.notebook.title).slice(0, 150))}</title><h1 dir="auto">${PdfRenderer.text(data.notebook.title)}</h1>`
    for (const note of data.notes) {
      html += `<section><h2 dir="auto">${PdfRenderer.text(pages.get(String(note.page_id)) ?? 'Page')}</h2><h3 dir="auto">${PdfRenderer.text(note.title)}</h3>`
      for (const block of blocksByNote.get(String(note.id)) ?? []) {
        const payload = JSON.parse(String(block.data_json ?? '{}')) as Record<string, unknown>
        const type = String(block.type)
        html += `<div class="label">${PdfRenderer.text(type)}</div>`
        if (typeof payload.text === 'string') html += this.paragraphs(payload.text)
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
          if (run && (run.transcript_text || this.hasReview(payload, run)))
            html += `<h4>${this.hasReview(payload, run) ? 'Reviewed transcript' : 'Transcription'}</h4>${this.paragraphs(this.reviewed(payload, run))}`
        }
        for (const citation of this.citations(data, block))
          html += `<p dir="auto" class="label">${PdfRenderer.text(citation)}</p>`
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
        `SELECT n.* FROM notes n JOIN pages p ON p.id=n.page_id WHERE p.notebook_id=? AND n.deleted_at IS NULL ${scope.type === 'note' ? 'AND n.id=?' : scope.type === 'page' ? 'AND n.page_id=?' : ''} AND p.deleted_at IS NULL ORDER BY p.position,n.position`
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
    const relationshipTargets = (
      this.db
        .prepare(
          `SELECT r.from_block_id AS fromBlockId, r.relation_type AS relationType, b.id AS targetId, b.data_json, b.type, n.title AS noteTitle, p.title AS pageTitle FROM block_relations r JOIN blocks b ON b.id=r.to_block_id JOIN notes n ON n.id=b.note_id JOIN pages p ON p.id=n.page_id WHERE r.from_block_id IN (${blockMarks}) AND b.deleted_at IS NULL AND n.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY r.created_at`
        )
        .all(...blockIds) as Array<Record<string, unknown>>
    ).map((row) => ({
      fromBlockId: String(row.fromBlockId),
      relationType: String(row.relationType),
      targetId: String(row.targetId),
      targetText: String(JSON.parse(String(row.data_json)).text ?? row.type),
      noteTitle: String(row.noteTitle),
      pageTitle: String(row.pageTitle)
    }))
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
    return {
      notebook,
      pages,
      notes,
      blocks,
      assets,
      relations,
      runs,
      segments,
      sources,
      blockSources,
      relationshipTargets
    }
  }
  private paragraphs(value: unknown): string {
    return String(value ?? '')
      .split('\n')
      .map((line) => `<p dir="auto">${PdfRenderer.text(line)}</p>`)
      .join('')
  }
  private hasReview(payload: Record<string, unknown>, run: Record<string, unknown>): boolean {
    return Object.hasOwn((payload.transcriptReviews as Record<string, unknown>) ?? {}, String(run.id))
  }
  private reviewed(payload: Record<string, unknown>, run: Record<string, unknown>): string {
    const reviews = payload.transcriptReviews as Record<string, { text: string }> | undefined
    return reviews?.[String(run.id)]?.text ?? String(run.transcript_text ?? '')
  }
  private citations(data: ScopeData, block: Record<string, unknown>): string[] {
    const citations = data.blockSources
      .filter((s) => s.block_id === block.id)
      .map((s) => {
        const source = data.sources.find((source) => source.id === s.source_document_id)
        return `Source: ${source?.title ?? 'PDF'}; PDF page ${s.pdf_page ?? '?'}${s.printed_page == null ? '' : `; printed page ${s.printed_page}`}`
      })
    for (const relation of data.relationshipTargets ?? [])
      if (relation.fromBlockId === block.id)
        citations.push(
          `${relation.relationType}: ${relation.pageTitle} / ${relation.noteTitle} / ${relation.targetText} (${relation.targetId})`
        )
    return citations
  }
  private markdown(data: ScopeData, semantic: boolean): string {
    const literal = (value: unknown) => String(value ?? '').replace(/[\\`*_{}[\]()<>#+.!|~-]/g, '\\$&')
    const pageNames = new Map(data.pages.map((page) => [String(page.id), String(page.title)]))
    let output = `# ${literal(data.notebook.title)}\n\n`
    for (const note of data.notes) {
      output += `## ${literal(pageNames.get(String(note.page_id)) ?? 'Page')} / ${literal(note.title)}\n\n`
      for (const block of data.blocks.filter((b) => b.note_id === note.id)) {
        const type = String(block.type)
        const payload = JSON.parse(String(block.data_json ?? '{}')) as Record<string, unknown>
        const label = semantic ? `[${type === 'source_text' ? 'SOURCE' : type.toUpperCase()}] ` : ''
        if (typeof payload.text === 'string' && payload.text) output += `${label}${literal(payload.text)}\n\n`
        if (typeof payload.assetId === 'string') {
          const asset = data.assets.find((item) => item.id === payload.assetId)
          const image = ['image', 'screenshot'].includes(type) ? '!' : ''
          output += `${label}${image}[${literal(payload.filename ?? type)}](${asset?.exportPath ?? 'assets/missing'})\n\n`
        }
        if (type === 'audio') {
          const run = data.runs.find((item) => item.id === payload.activeTranscriptionRunId)
          if (run && (run.transcript_text || this.hasReview(payload, run)))
            output += `${this.hasReview(payload, run) ? 'Reviewed transcript' : 'Transcript'}: ${literal(this.reviewed(payload, run))}\n\n`
        }
        for (const citation of this.citations(data, block)) output += `${literal(citation)}\n\n`
      }
    }
    return output
  }
  private scopeId(scope: ExportScope): string {
    return scope.type === 'notebook' ? scope.notebookId : scope.type === 'page' ? scope.pageId : scope.noteId
  }
}
