import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { directoryContains, physicalPath } from '../library-path'
import type {
  Asset,
  AssetDiagnostics,
  AssetKind,
  Block,
  BlockRelation,
  BlockSource,
  BlockType,
  Notebook,
  NotebookTree,
  Note,
  Page,
  PageWorkspace,
  RelationType,
  SearchResult,
  SourceDocument,
  TextBlockType,
  TrashEntityType,
  TrashRecord
} from '../../shared/domain'
import { textBlockTypes } from '../../shared/domain'
import { NotebookDatabase } from '../database/database'
import {
  TranscriptionConfig,
  TranscriptionService,
  OpenRouterProvider,
  WhisperCppProvider,
  WhisperModelManager
} from './transcription-service'
import { ExportService, validateLosslessArchive } from './export-service'
import { JobService } from './job-service'
import { ThumbnailService } from './thumbnail-service'
import { PdfRenderer } from './pdf-renderer'
import { ErrorLogService } from './error-log-service'
import type {
  AppPreferences,
  ExportFormat,
  ExportResult,
  ExportScope,
  ImportResult,
  Job,
  LibraryMigrationStatus,
  StorageSummary,
  TranscriptionProviderName,
  TranscriptionRun,
  TranscriptionSettings,
  WhisperModel
} from '../../shared/domain'

type DeletedRow = { deleted_at: string | null; deletion_operation_id: string | null }
type NotebookRow = { id: string; title: string; created_at: string; updated_at: string } & DeletedRow
type PageRow = {
  id: string
  notebook_id: string
  title: string
  position: number
  created_at: string
  updated_at: string
} & DeletedRow
type NoteRow = {
  id: string
  page_id: string
  title: string
  position: number
  created_at: string
  updated_at: string
} & DeletedRow
type BlockRow = {
  id: string
  note_id: string
  type: BlockType
  position: number
  data_json: string
  metadata_json: string
  created_at: string
  updated_at: string
} & DeletedRow
type RelationRow = {
  id: string
  from_block_id: string
  to_block_id: string
  relation_type: RelationType
  metadata_json: string
  created_at: string
}
type SearchRow = {
  entity_type: TrashEntityType
  entity_id: string
  notebook_id: string | null
  page_id: string | null
  note_id: string | null
  note_position: number | null
  title: string
  excerpt: string
}
type AssetRow = {
  id: string
  notebook_id: string
  kind: AssetKind
  relative_path: string
  original_filename: string | null
  mime_type: string | null
  byte_size: number | null
  sha256: string | null
  metadata_json: string
  created_at: string
  updated_at: string
}
type SourceRow = {
  id: string
  notebook_id: string
  asset_id: string
  title: string
  source_type: 'pdf'
  relative_path: string
  metadata_json: string
  created_at: string
  updated_at: string
}
type SourceBlockRow = {
  id: string
  block_id: string
  source_document_id: string
  selection_type: 'text' | 'region'
  pdf_page: number | null
  printed_page: number | null
  bounds_json: string | null
  extracted_text: string | null
  created_at: string
}

const PAGE_SIZE = 50
const now = (): string => new Date().toISOString()
const deletion = (row: DeletedRow) => ({ deletedAt: row.deleted_at, deletionOperationId: row.deletion_operation_id })
const asNotebook = (row: NotebookRow): Notebook => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...deletion(row)
})
const asPage = (row: PageRow): Page => ({
  id: row.id,
  notebookId: row.notebook_id,
  title: row.title,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...deletion(row)
})
const asNote = (row: NoteRow): Note => ({
  id: row.id,
  pageId: row.page_id,
  title: row.title,
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...deletion(row)
})
const asBlock = (row: BlockRow): Block => ({
  id: row.id,
  noteId: row.note_id,
  type: row.type,
  position: row.position,
  data: JSON.parse(row.data_json) as Record<string, unknown>,
  metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...deletion(row)
})
const asRelation = (row: RelationRow): BlockRelation => ({
  id: row.id,
  fromBlockId: row.from_block_id,
  toBlockId: row.to_block_id,
  relationType: row.relation_type,
  metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  createdAt: row.created_at
})
const asAsset = (row: AssetRow): Asset => ({
  id: row.id,
  notebookId: row.notebook_id,
  kind: row.kind,
  relativePath: row.relative_path,
  originalFilename: row.original_filename,
  mimeType: row.mime_type,
  byteSize: row.byte_size,
  sha256: row.sha256,
  metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})
const asSource = (row: SourceRow): SourceDocument => ({
  id: row.id,
  notebookId: row.notebook_id,
  assetId: row.asset_id,
  title: row.title,
  sourceType: row.source_type,
  relativePath: row.relative_path,
  metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})
const asBlockSource = (row: SourceBlockRow): BlockSource => ({
  id: row.id,
  blockId: row.block_id,
  sourceDocumentId: row.source_document_id,
  selectionType: row.selection_type,
  pdfPage: row.pdf_page,
  printedPage: row.printed_page,
  bounds: row.bounds_json ? (JSON.parse(row.bounds_json) as BlockSource['bounds']) : null,
  extractedText: row.extracted_text,
  createdAt: row.created_at
})

function missing(entity: string, id: string): Error {
  return new Error(`${entity} “${id}” does not exist or is no longer available.`)
}
function safeJson(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    throw new Error('The archive contains invalid JSON metadata.')
  }
}
function cursorPosition(cursor: string | undefined): number {
  if (cursor === undefined) return -1
  if (!/^\d+$/.test(cursor)) throw new Error('The page cursor is invalid.')
  return Number(cursor)
}

export class NotebookService {
  private readonly db
  private readonly assetsDirectory
  private readonly transcription: TranscriptionService
  private readonly exports: ExportService
  private readonly transcriptionConfig: TranscriptionConfig
  private readonly whisperModels: WhisperModelManager
  private readonly jobs: JobService
  private readonly errors: ErrorLogService
  private readonly databasePath: string
  private readonly thumbnails: ThumbnailService
  private readonly pdfRenderer: PdfRenderer
  private readonly configDirectory: string
  private readonly libraryRoot: string
  private readonly bootstrapPath: string | null
  private externalWrites = 0
  private storageCache: { at: number; assets: number; models: number } | null = null
  private migration: LibraryMigrationStatus = { state: 'idle', destination: null, error: null }

  constructor(
    database: NotebookDatabase,
    assetsDirectory = join(tmpdir(), 'research-notebook-assets'),
    configDirectory = join(tmpdir(), 'research-notebook-config'),
    localWhisper?: { binaryPath: string | null; modelPath: string | null },
    library?: { root: string; bootstrapPath: string; previousRoot?: string | null },
    errors?: ErrorLogService
  ) {
    this.db = database.connection
    this.databasePath = database.path
    this.assetsDirectory = resolve(assetsDirectory)
    this.configDirectory = resolve(configDirectory)
    this.libraryRoot = resolve(library?.root ?? dirname(this.databasePath))
    this.bootstrapPath = library?.bootstrapPath ?? null
    if (library?.previousRoot) this.migration = { state: 'active', destination: library.previousRoot, error: null }
    for (const folder of ['images', 'screenshots', 'audio', 'files'])
      mkdirSync(join(this.assetsDirectory, folder), { recursive: true })
    this.transcriptionConfig = new TranscriptionConfig(configDirectory)
    this.whisperModels = new WhisperModelManager(
      join(configDirectory, 'whisper-models'),
      localWhisper?.binaryPath ?? null
    )
    this.transcription = new TranscriptionService(
      this.db,
      (path) => this.absoluteAssetPath(path),
      {
        local: new WhisperCppProvider(() => {
          const selected = this.transcriptionConfig.selectedModel()
          const local = this.whisperModels.getStatus(selected)
          return { binaryPath: local.binaryPath, modelPath: localWhisper?.modelPath ?? local.modelPath }
        }),
        openrouter: new OpenRouterProvider(() => this.transcriptionConfig.getKey())
      },
      () => {
        const selected = this.transcriptionConfig.selectedModel()
        const local = this.whisperModels.getStatus(selected)
        const descriptor = WhisperModelManager.catalog.find((model) => model.id === selected)!
        return {
          openRouterConfigured: Boolean(this.transcriptionConfig.getKey()),
          localModels: this.whisperModels
            .list()
            .filter((model) => model.installed)
            .map((model) => model.id),
          openRouterModels: ['openai/whisper-large-v3'],
          localBinaryAvailable: Boolean(local.binaryPath),
          localModelAvailable: local.available,
          selectedLocalModel: local.available
            ? { id: descriptor.id, displayName: descriptor.displayName, sizeBytes: descriptor.sizeBytes }
            : null,
          localDownload: local.download
        }
      }
    )
    this.exports = new ExportService(this.db, (path) => this.absoluteAssetPath(path))
    this.pdfRenderer = new PdfRenderer()
    this.thumbnails = new ThumbnailService(this.db, join(this.assetsDirectory, '.thumbnails'), (path) =>
      this.absoluteAssetPath(path)
    )
    this.errors =
      errors ?? new ErrorLogService(this.db, join(this.libraryRoot, 'error-events-fallback.ndjson'), null, true)
    this.jobs = new JobService(this.db, this.errors)
    this.jobs.register('export', async (payload, progress, cancelled) => {
      progress(5)
      if (cancelled()) throw new Error('Cancelled')
      const result = this.exports.start(
        payload.scope as ExportScope,
        payload.format as ExportFormat,
        String(payload.destination)
      )
      if (cancelled()) {
        rmSync(result.directory, { recursive: true, force: true })
        throw new Error('Cancelled')
      }
      progress(100)
      return result as unknown as Record<string, unknown>
    })
    this.jobs.register('pdf', async (payload, progress, cancelled) => {
      progress(5)
      if (cancelled()) throw new Error('Cancelled')
      const markup = this.exports.printableDocument(payload.scope as ExportScope)
      progress(30)
      if (cancelled()) throw new Error('Cancelled')
      const bytes = await this.pdfRenderer.print(markup)
      progress(80)
      if (cancelled()) throw new Error('Cancelled')
      const result = this.exports.start(payload.scope as ExportScope, 'pdf', String(payload.destination), bytes)
      if (cancelled()) {
        rmSync(result.directory, { recursive: true, force: true })
        throw new Error('Cancelled')
      }
      progress(100)
      return result as unknown as Record<string, unknown>
    })
    this.jobs.register('asset-integrity', async (payload, progress, cancelled) => {
      const assets = this.listAssets(String(payload.notebookId))
      const bad: string[] = []
      assets.forEach((asset, index) => {
        if (cancelled()) throw new Error('Cancelled')
        const path = this.absoluteAssetPath(asset.relativePath)
        if (
          existsSync(path) &&
          asset.sha256 &&
          createHash('sha256').update(readFileSync(path)).digest('hex') !== asset.sha256
        )
          bad.push(asset.id)
        progress(((index + 1) / Math.max(assets.length, 1)) * 100)
      })
      return { hashMismatchedAssetIds: bad }
    })
    this.jobs.register('thumbnail', async (payload, progress, cancelled) => {
      progress(10)
      try {
        const result = await this.thumbnails.generate(
          String(payload.assetId),
          Number(payload.width),
          Number(payload.height),
          cancelled
        )
        progress(100)
        return result
      } finally {
        this.storageCache = null
      }
    })
    this.jobs.register('transcription', async (payload, progress, cancelled) => {
      const run = await this.transcription.execute(String(payload.runId), cancelled, (value) => progress(value))
      if (run.status === 'cancelled') throw new Error('Cancelled')
      if (run.status !== 'completed') throw new Error(run.errorMessage ?? 'Local transcription failed.')
      return { transcriptionRunId: run.id }
    })
    this.jobs.register('backup', async (payload, progress, cancelled) =>
      this.backupLibrary(String(payload.destination), progress, cancelled)
    )
    this.jobs.register('model-download', async (payload, progress, cancelled) => {
      try {
        await this.whisperModels.download(String(payload.modelId), cancelled, progress)
      } finally {
        this.storageCache = null
      }
      return { modelId: String(payload.modelId) }
    })
    this.jobs.register('library-move', async (payload, progress, cancelled) =>
      this.moveLibrary(String(payload.destination), progress, cancelled)
    )
  }

  async finishPendingWrites(): Promise<void> {
    const active = this.db.prepare("SELECT id FROM jobs WHERE status IN ('queued','running')").all() as { id: string }[]
    for (const job of active) this.cancelJob(job.id)
    while (this.externalWrites || this.db.prepare("SELECT id FROM jobs WHERE status='running' LIMIT 1").get())
      await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assertWritable(): void {
    if (['queued', 'copying', 'pending-restart'].includes(this.migration.state))
      throw new Error('Library move in progress. Restart after the verified copy before editing.')
    this.storageCache = null
  }
  listNotebooks(): NotebookTree[] {
    const notebooks = this.db
      .prepare('SELECT * FROM notebooks WHERE deleted_at IS NULL ORDER BY updated_at DESC')
      .all() as NotebookRow[]
    const pagesForNotebook = this.db.prepare(
      'SELECT * FROM pages WHERE notebook_id = ? AND deleted_at IS NULL ORDER BY position'
    )
    return notebooks.map((notebook) => ({
      ...asNotebook(notebook),
      pages: (pagesForNotebook.all(notebook.id) as PageRow[]).map(asPage)
    }))
  }

  createNotebook(title: string): Notebook {
    this.assertWritable()
    return this.db.transaction(() => {
      const createdAt = now()
      const notebook: NotebookRow = {
        id: randomUUID(),
        title,
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
        deletion_operation_id: null
      }
      this.db
        .prepare(
          'INSERT INTO notebooks (id, title, created_at, updated_at) VALUES (@id, @title, @created_at, @updated_at)'
        )
        .run(notebook)
      this.refreshSearchIndex()
      return asNotebook(notebook)
    })()
  }

  updateNotebook(notebookId: string, title: string): Notebook {
    this.assertWritable()
    return this.db.transaction(() => {
      const updatedAt = now()
      if (
        this.db
          .prepare('UPDATE notebooks SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
          .run(title, updatedAt, notebookId).changes !== 1
      )
        throw missing('Notebook', notebookId)
      const notebook = this.db.prepare('SELECT * FROM notebooks WHERE id = ?').get(notebookId) as NotebookRow
      this.refreshSearchIndex()
      return asNotebook(notebook)
    })()
  }

  createPage(notebookId: string, title: string): Page {
    this.assertWritable()
    return this.db.transaction(() => {
      this.requireActive('notebook', notebookId)
      const createdAt = now()
      const page: PageRow = {
        id: randomUUID(),
        notebook_id: notebookId,
        title,
        position: this.nextPosition('pages', 'notebook_id', notebookId),
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
        deletion_operation_id: null
      }
      this.db
        .prepare(
          'INSERT INTO pages (id, notebook_id, title, position, created_at, updated_at) VALUES (@id, @notebook_id, @title, @position, @created_at, @updated_at)'
        )
        .run(page)
      this.touchNotebook(notebookId, createdAt)
      this.refreshSearchIndex()
      return asPage(page)
    })()
  }

  updatePage(pageId: string, title: string): Page {
    this.assertWritable()
    return this.db.transaction(() => {
      const updatedAt = now()
      if (
        this.db
          .prepare('UPDATE pages SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
          .run(title, updatedAt, pageId).changes !== 1
      )
        throw missing('Page', pageId)
      const page = this.db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId) as PageRow
      this.touchNotebook(page.notebook_id, updatedAt)
      this.refreshSearchIndex()
      return asPage(page)
    })()
  }

  getPageWorkspace(pageId: string, cursor?: string): PageWorkspace {
    const page = this.db.prepare('SELECT * FROM pages WHERE id = ? AND deleted_at IS NULL').get(pageId) as
      PageRow | undefined
    if (!page) throw missing('Page', pageId)
    const notes = this.db
      .prepare(
        'SELECT * FROM notes WHERE page_id = ? AND deleted_at IS NULL AND position > ? ORDER BY position LIMIT ?'
      )
      .all(pageId, cursorPosition(cursor), PAGE_SIZE + 1) as NoteRow[]
    const hasMore = notes.length > PAGE_SIZE
    const visibleNotes = notes.slice(0, PAGE_SIZE)
    const blocksForNote = this.db.prepare(
      'SELECT * FROM blocks WHERE note_id = ? AND deleted_at IS NULL ORDER BY position'
    )
    return {
      ...asPage(page),
      notes: visibleNotes.map((note) => ({
        ...asNote(note),
        blocks: (blocksForNote.all(note.id) as BlockRow[]).map(asBlock)
      })),
      nextCursor: hasMore ? String(visibleNotes.at(-1)?.position) : null
    }
  }

  createNote(pageId: string, title: string): Note {
    this.assertWritable()
    return this.db.transaction(() => {
      const page = this.db.prepare('SELECT notebook_id FROM pages WHERE id = ? AND deleted_at IS NULL').get(pageId) as
        { notebook_id: string } | undefined
      if (!page) throw missing('Page', pageId)
      const createdAt = now()
      const note: NoteRow = {
        id: randomUUID(),
        page_id: pageId,
        title,
        position: this.nextPosition('notes', 'page_id', pageId),
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
        deletion_operation_id: null
      }
      this.db
        .prepare(
          'INSERT INTO notes (id, page_id, title, position, created_at, updated_at) VALUES (@id, @page_id, @title, @position, @created_at, @updated_at)'
        )
        .run(note)
      this.touchNotebook(page.notebook_id, createdAt)
      this.refreshSearchIndex()
      return asNote(note)
    })()
  }

  updateNote(noteId: string, title: string): Note {
    this.assertWritable()
    return this.db.transaction(() => {
      const updatedAt = now()
      if (
        this.db
          .prepare('UPDATE notes SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
          .run(title, updatedAt, noteId).changes !== 1
      )
        throw missing('Note', noteId)
      const note = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as NoteRow
      this.touchNoteNotebook(noteId, updatedAt)
      this.refreshSearchIndex()
      return asNote(note)
    })()
  }

  duplicateNote(noteId: string): Note {
    this.assertWritable()
    return this.db.transaction(() => {
      const original = this.activeRow('note', noteId) as NoteRow
      const createdAt = now()
      const copy: NoteRow = {
        ...original,
        id: randomUUID(),
        title: `${original.title} copy`,
        position: this.nextPosition('notes', 'page_id', original.page_id),
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
        deletion_operation_id: null
      }
      this.db
        .prepare(
          'INSERT INTO notes (id, page_id, title, position, created_at, updated_at) VALUES (@id, @page_id, @title, @position, @created_at, @updated_at)'
        )
        .run(copy)
      const blocks = this.db
        .prepare('SELECT * FROM blocks WHERE note_id = ? AND deleted_at IS NULL ORDER BY position')
        .all(noteId) as BlockRow[]
      const insert = this.db.prepare(
        'INSERT INTO blocks (id, note_id, type, position, data_json, metadata_json, created_at, updated_at) VALUES (@id, @note_id, @type, @position, @data_json, @metadata_json, @created_at, @updated_at)'
      )
      blocks.forEach((block, position) =>
        insert.run({
          ...block,
          id: randomUUID(),
          note_id: copy.id,
          position,
          created_at: createdAt,
          updated_at: createdAt
        })
      )
      this.touchNoteNotebook(copy.id, createdAt)
      this.refreshSearchIndex()
      return asNote(copy)
    })()
  }

  createBlock(noteId: string, type: BlockType, data: Record<string, unknown> = {}): Block {
    this.assertWritable()
    return this.db.transaction(() => {
      this.requireActive('note', noteId)
      const createdAt = now()
      const block: BlockRow = {
        id: randomUUID(),
        note_id: noteId,
        type,
        position: this.nextPosition('blocks', 'note_id', noteId),
        data_json: JSON.stringify(data),
        metadata_json: '{}',
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
        deletion_operation_id: null
      }
      this.db
        .prepare(
          'INSERT INTO blocks (id, note_id, type, position, data_json, metadata_json, created_at, updated_at) VALUES (@id, @note_id, @type, @position, @data_json, @metadata_json, @created_at, @updated_at)'
        )
        .run(block)
      this.touchNoteNotebook(noteId, createdAt)
      this.refreshSearchIndex()
      return asBlock(block)
    })()
  }

  updateBlock(blockId: string, data: Record<string, unknown>): Block {
    this.assertWritable()
    return this.db.transaction(() => {
      const updatedAt = now()
      if (
        this.db
          .prepare('UPDATE blocks SET data_json = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
          .run(JSON.stringify(data), updatedAt, blockId).changes !== 1
      )
        throw missing('Block', blockId)
      const block = this.db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId) as BlockRow
      this.touchNoteNotebook(block.note_id, updatedAt)
      this.refreshSearchIndex()
      return asBlock(block)
    })()
  }

  updateBlockType(blockId: string, type: TextBlockType): Block {
    this.assertWritable()
    return this.db.transaction(() => {
      const block = this.activeRow('block', blockId) as BlockRow
      if (!(textBlockTypes as readonly string[]).includes(block.type))
        throw new Error('Only text-based blocks can be converted.')
      const updatedAt = now()
      this.db.prepare('UPDATE blocks SET type = ?, updated_at = ? WHERE id = ?').run(type, updatedAt, blockId)
      this.touchNoteNotebook(block.note_id, updatedAt)
      this.refreshSearchIndex()
      return asBlock({ ...block, type, updated_at: updatedAt })
    })()
  }

  duplicateBlock(blockId: string): Block {
    this.assertWritable()
    return this.db.transaction(() => {
      const original = this.activeRow('block', blockId) as BlockRow
      const createdAt = now()
      const copy: BlockRow = {
        ...original,
        id: randomUUID(),
        position: this.nextPosition('blocks', 'note_id', original.note_id),
        created_at: createdAt,
        updated_at: createdAt,
        deleted_at: null,
        deletion_operation_id: null
      }
      this.db
        .prepare(
          'INSERT INTO blocks (id, note_id, type, position, data_json, metadata_json, created_at, updated_at) VALUES (@id, @note_id, @type, @position, @data_json, @metadata_json, @created_at, @updated_at)'
        )
        .run(copy)
      this.touchNoteNotebook(copy.note_id, createdAt)
      this.refreshSearchIndex()
      return asBlock(copy)
    })()
  }

  reorderBlocks(noteId: string, blockIds: string[]): void {
    this.assertWritable()
    this.db.transaction(() => {
      this.requireActive('note', noteId)
      const existing = this.db
        .prepare('SELECT id FROM blocks WHERE note_id = ? AND deleted_at IS NULL ORDER BY position')
        .all(noteId) as Array<{ id: string }>
      if (
        existing.length !== blockIds.length ||
        new Set(blockIds).size !== blockIds.length ||
        existing.some(({ id }) => !blockIds.includes(id))
      )
        throw new Error('Unable to reorder blocks because the submitted order does not match this note.')
      const setPosition = this.db.prepare('UPDATE blocks SET position = ?, updated_at = ? WHERE id = ?')
      const updatedAt = now()
      existing.forEach(({ id }, index) => setPosition.run(-1000000 - index, updatedAt, id))
      blockIds.forEach((id, index) => setPosition.run(index, updatedAt, id))
      this.touchNoteNotebook(noteId, updatedAt)
    })()
  }

  listRelations(blockId: string): BlockRelation[] {
    this.requireActive('block', blockId)
    return (
      this.db
        .prepare('SELECT * FROM block_relations WHERE from_block_id = ? OR to_block_id = ? ORDER BY created_at')
        .all(blockId, blockId) as RelationRow[]
    ).map(asRelation)
  }

  createRelation(fromBlockId: string, toBlockId: string, relationType: RelationType): BlockRelation {
    this.assertWritable()
    return this.db.transaction(() => {
      if (fromBlockId === toBlockId) throw new Error('A block cannot be related to itself.')
      const from = this.blockNotebook(fromBlockId)
      const to = this.blockNotebook(toBlockId)
      if (!from || !to) throw new Error('Both related blocks must be active.')
      if (from.notebook_id !== to.notebook_id) throw new Error('Related blocks must belong to the same notebook.')
      const relation: RelationRow = {
        id: randomUUID(),
        from_block_id: fromBlockId,
        to_block_id: toBlockId,
        relation_type: relationType,
        metadata_json: '{}',
        created_at: now()
      }
      this.db
        .prepare(
          'INSERT INTO block_relations (id, from_block_id, to_block_id, relation_type, metadata_json, created_at) VALUES (@id, @from_block_id, @to_block_id, @relation_type, @metadata_json, @created_at)'
        )
        .run(relation)
      return asRelation(relation)
    })()
  }

  removeRelation(relationId: string): void {
    this.assertWritable()
    if (this.db.prepare('DELETE FROM block_relations WHERE id = ?').run(relationId).changes !== 1)
      throw missing('Relation', relationId)
  }

  importAsset(notebookId: string, kind: AssetKind, sourcePath: string): Asset {
    this.assertWritable()
    this.requireActive('notebook', notebookId)
    const file = statSync(sourcePath)
    if (!file.isFile()) throw new Error('Only files can be imported as assets.')
    const id = randomUUID()
    const extension = extname(sourcePath).toLowerCase()
    const folder =
      kind === 'image' ? 'images' : kind === 'screenshot' ? 'screenshots' : kind === 'audio' ? 'audio' : 'files'
    const relativePath = join('assets', folder, `${id}${extension || '.bin'}`).replaceAll('\\', '/')
    const destination = this.absoluteAssetPath(relativePath)
    const temporary = `${destination}.${randomUUID()}.tmp`
    copyFileSync(sourcePath, temporary)
    renameSync(temporary, destination)
    const timestamp = now()
    const row: AssetRow = {
      id,
      notebook_id: notebookId,
      kind,
      relative_path: relativePath,
      original_filename: basename(sourcePath),
      mime_type: this.mimeType(extension),
      byte_size: file.size,
      sha256: createHash('sha256').update(readFileSync(destination)).digest('hex'),
      metadata_json: '{}',
      created_at: timestamp,
      updated_at: timestamp
    }
    try {
      this.db
        .prepare(
          'INSERT INTO assets (id, notebook_id, kind, relative_path, original_filename, mime_type, byte_size, sha256, metadata_json, created_at, updated_at) VALUES (@id, @notebook_id, @kind, @relative_path, @original_filename, @mime_type, @byte_size, @sha256, @metadata_json, @created_at, @updated_at)'
        )
        .run(row)
    } catch (error) {
      rmSync(destination, { force: true })
      throw error
    }
    return asAsset(row)
  }

  listAssets(notebookId: string): Asset[] {
    this.requireActive('notebook', notebookId)
    return (
      this.db
        .prepare('SELECT * FROM assets WHERE notebook_id = ? ORDER BY created_at DESC')
        .all(notebookId) as AssetRow[]
    ).map(asAsset)
  }
  assetDataUrl(assetId: string): string {
    const asset = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as AssetRow | undefined
    if (!asset) throw missing('Asset', assetId)
    const path = this.absoluteAssetPath(asset.relative_path)
    if (!existsSync(path)) throw new Error('The asset file is missing. Run asset diagnostics to locate it.')
    return `data:${asset.mime_type ?? 'application/octet-stream'};base64,${readFileSync(path).toString('base64')}`
  }
  requestThumbnail(assetId: string, width: number, height: number) {
    this.assertWritable()
    this.assetDataUrl(assetId) // validates ownership/existence without exposing its path
    return this.jobs.start('thumbnail', { assetId, width, height })
  }
  thumbnailDataUrl(assetId: string, width: number, height: number): string | null {
    return this.thumbnails.get(assetId, width, height)
  }
  attachAsset(noteId: string, assetId: string, type: 'image' | 'screenshot' | 'audio' | 'file'): Block {
    this.assertWritable()
    const noteNotebook = this.db
      .prepare(
        'SELECT pages.notebook_id FROM notes JOIN pages ON pages.id = notes.page_id WHERE notes.id = ? AND notes.deleted_at IS NULL'
      )
      .get(noteId) as { notebook_id: string } | undefined
    const asset = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as AssetRow | undefined
    if (!noteNotebook || !asset || asset.notebook_id !== noteNotebook.notebook_id)
      throw new Error('The asset must belong to the active note’s notebook.')
    if (asset.kind !== type && !(type === 'screenshot' && asset.kind === 'image'))
      throw new Error('The selected asset kind does not match this block type.')
    const block = this.createBlock(noteId, type, {
      assetId,
      filename: asset.original_filename,
      mimeType: asset.mime_type
    })
    this.db
      .prepare('INSERT INTO asset_references (asset_id, block_id, created_at) VALUES (?, ?, ?)')
      .run(assetId, block.id, now())
    return block
  }
  saveRecording(noteId: string, wavBase64: string, filename = 'recording.wav', operationId?: string): Block {
    this.assertWritable()
    this.requireActive('note', noteId)
    if (operationId) {
      const prior = this.db
        .prepare(
          "SELECT * FROM blocks WHERE note_id=? AND type='audio' AND json_extract(metadata_json,'$.recordingOperationId')=? AND deleted_at IS NULL"
        )
        .get(noteId, operationId) as BlockRow | undefined
      if (prior) return asBlock(prior)
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(wavBase64) || wavBase64.length > 80_000_000)
      throw new Error('The recording data is invalid or too large.')
    const bytes = Buffer.from(wavBase64, 'base64')
    if (
      bytes.length < 44 ||
      bytes.length > 50_000_000 ||
      bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WAVE' ||
      bytes.readUInt16LE(20) !== 1 ||
      bytes.readUInt16LE(22) !== 1 ||
      bytes.readUInt32LE(24) !== 16000 ||
      bytes.readUInt16LE(34) !== 16
    )
      throw new Error('Recording must be a 16 kHz mono PCM WAV file.')
    const notebook = this.db
      .prepare('SELECT p.notebook_id FROM notes n JOIN pages p ON p.id=n.page_id WHERE n.id=?')
      .get(noteId) as { notebook_id: string }
    const relativePath = this.writeBytes('audio' as 'screenshots', wavBase64, '.wav')
    try {
      return this.db.transaction(() => {
        const asset = this.insertWrittenAsset(
          notebook.notebook_id,
          'audio',
          relativePath,
          filename.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 180),
          'audio/wav'
        )
        const durationMs = Math.round(((bytes.length - 44) / 32000) * 1000)
        const block = this.createBlock(noteId, 'audio', {
          assetId: asset.id,
          filename: asset.originalFilename,
          mimeType: 'audio/wav',
          durationMs
        })
        this.db
          .prepare('INSERT INTO asset_references (asset_id, block_id, created_at) VALUES (?, ?, ?)')
          .run(asset.id, block.id, now())
        if (operationId)
          this.db
            .prepare('UPDATE blocks SET metadata_json=? WHERE id=?')
            .run(JSON.stringify({ recordingOperationId: operationId }), block.id)
        return { ...block, metadata: operationId ? { recordingOperationId: operationId } : block.metadata }
      })()
    } catch (error) {
      rmSync(this.absoluteAssetPath(relativePath), { force: true })
      throw error
    }
  }
  async createTranscription(
    blockId: string,
    provider: TranscriptionProviderName,
    model?: string,
    language?: string
  ): Promise<Job | TranscriptionRun> {
    this.assertWritable()
    const chosen =
      model ?? (provider === 'local' ? this.transcriptionConfig.selectedModel() : 'openai/whisper-large-v3')
    if (provider === 'local') {
      const local = this.whisperModels.getStatus(chosen)
      if (!local.binaryPath)
        throw new Error('Local transcription is unavailable because the bundled Whisper sidecar is missing.')
      if (!local.available)
        throw new Error('Download the selected Whisper model in Settings before starting local transcription.')
    }
    const run = this.transcription.create(blockId, provider, chosen, language)
    if (provider === 'local') return this.jobs.start('transcription', { runId: run.id })
    this.externalWrites++
    try {
      return await this.transcription.execute(run.id)
    } finally {
      this.externalWrites--
    }
  }
  getTranscription(runId: string): TranscriptionRun {
    return this.transcription.get(runId)
  }
  listTranscriptions(blockId: string): TranscriptionRun[] {
    this.requireActive('block', blockId)
    return this.transcription.list(blockId)
  }
  async retryTranscription(runId: string): Promise<Job | TranscriptionRun> {
    this.assertWritable()
    const prior = this.transcription.get(runId)
    const run = this.transcription.create(prior.blockId, prior.provider, prior.model, prior.language ?? undefined)
    if (prior.provider === 'local') return this.jobs.start('transcription', { runId: run.id, retryOf: runId })
    this.externalWrites++
    try {
      return await this.transcription.execute(run.id)
    } finally {
      this.externalWrites--
    }
  }
  transcriptionSettings(): TranscriptionSettings {
    return this.transcription.getSettings()
  }
  setOpenRouterKey(key: string): void {
    this.assertWritable()
    if (key.length > 1000) throw new Error('The OpenRouter key is too long.')
    this.transcriptionConfig.setKey(key)
  }
  removeOpenRouterKey(): void {
    this.assertWritable()
    this.transcriptionConfig.removeKey()
  }
  preferences(): AppPreferences {
    return this.transcriptionConfig.preferences()
  }
  updatePreferences(input: Partial<AppPreferences>): AppPreferences {
    this.assertWritable()
    this.transcriptionConfig.setPreferences(input)
    return this.preferences()
  }
  listWhisperModels(): WhisperModel[] {
    return this.whisperModels.list()
  }
  downloadWhisperModel(modelId: string): Job {
    this.assertWritable()
    if (this.whisperModels.getStatus(modelId).available) throw new Error('This Whisper model is already installed.')
    return this.jobs.start('model-download', { modelId })
  }
  cancelWhisperModelDownload(modelId: string): void {
    const active = this.jobs
      .list()
      .find(
        (job) =>
          job.kind === 'model-download' &&
          ['queued', 'running'].includes(job.status) &&
          this.jobPayloadModel(job.id) === modelId
      )
    if (active) this.jobs.cancel(active.id)
    else if (!this.whisperModels.getStatus(modelId).available) throw new Error('No download is running for this model.')
  }
  removeWhisperModel(modelId: string): void {
    this.assertWritable()
    if (modelId === this.transcriptionConfig.selectedModel())
      throw new Error('Choose another installed default model before removing this one.')
    this.whisperModels.remove(modelId)
  }
  setDefaultWhisperModel(modelId: string): void {
    this.assertWritable()
    if (!this.whisperModels.getStatus(modelId).available)
      throw new Error('Download this Whisper model before choosing it as default.')
    this.transcriptionConfig.setSelectedModel(modelId)
  }
  export(scope: ExportScope, format: ExportFormat, destination: string): ExportResult {
    this.assertWritable()
    return this.exports.start(scope, format, destination)
  }
  startExport(scope: ExportScope, format: ExportFormat, destination: string) {
    this.assertWritable()
    return this.jobs.start(format === 'pdf' ? 'pdf' : 'export', { scope, format, destination })
  }
  listJobs() {
    return this.jobs.list()
  }
  resumeJobs() {
    this.jobs.resume()
  }
  cancelJob(jobId: string) {
    const job = this.jobs.cancel(jobId)
    if (job.kind === 'library-move' && job.status === 'cancelled')
      this.migration = { state: 'idle', destination: null, error: null }
    return job
  }
  retryJob(jobId: string) {
    this.assertWritable()
    const prior = this.jobs.get(jobId)
    if (prior.kind === 'library-move') {
      if (!['failed', 'cancelled'].includes(prior.status))
        throw new Error('Only failed or cancelled jobs can be retried.')
      const row = this.db.prepare('SELECT payload_json FROM jobs WHERE id=?').get(jobId) as { payload_json: string }
      return this.startLibraryMove(String(JSON.parse(row.payload_json).destination))
    }
    return this.jobs.retry(jobId)
  }
  startIntegrityScan(notebookId: string) {
    this.assertWritable()
    return this.jobs.start('asset-integrity', { notebookId })
  }
  startBackup(destination: string) {
    this.assertWritable()
    return this.jobs.start('backup', { destination })
  }
  storageSummary(refresh = false): StorageSummary {
    if (refresh || !this.storageCache || Date.now() - this.storageCache.at > 5000)
      this.storageCache = {
        at: Date.now(),
        assets: this.directoryBytes(this.assetsDirectory),
        models: this.directoryBytes(join(this.configDirectory, 'whisper-models'))
      }
    return {
      libraryPath: this.libraryRoot,
      databaseBytes: existsSync(this.databasePath) ? statSync(this.databasePath).size : 0,
      assetsBytes: this.storageCache.assets,
      modelsBytes: this.storageCache.models,
      oldLibraryPath: this.migration.state === 'active' ? this.migration.destination : null,
      migration: this.migration
    }
  }
  migrationStatus(): LibraryMigrationStatus {
    return this.migration
  }
  startLibraryMove(destination: string): Job {
    if (this.databasePath === ':memory:') throw new Error('A disk-backed library is required for migration.')
    this.assertWritable()
    if (
      this.externalWrites ||
      this.db.prepare("SELECT id FROM jobs WHERE status IN ('queued','running') LIMIT 1").get()
    )
      throw new Error('Finish or cancel all background jobs before moving the library.')
    if (directoryContains(physicalPath(this.libraryRoot), physicalPath(destination)))
      throw new Error('Choose a location outside the current library.')
    this.migration = { state: 'queued', destination, error: null }
    try {
      return this.jobs.start('library-move', { destination })
    } catch (error) {
      this.migration = { state: 'failed', destination, error: String(error) }
      throw error
    }
  }
  removeOldLibrary(): void {
    if (this.migration.state !== 'active' || !this.migration.destination)
      throw new Error('There is no retained original library to remove.')
    const old = resolve(this.migration.destination)
    if (!this.bootstrapPath) throw new Error('Destination activation cannot be verified.')
    const pointer = JSON.parse(readFileSync(this.bootstrapPath, 'utf8')) as {
      activeRoot?: string
      previousRoot?: string
    }
    if (pointer.activeRoot !== this.libraryRoot || pointer.previousRoot !== old)
      throw new Error('Restart must activate the destination before removing the original.')
    if (old === this.libraryRoot) throw new Error('The active library cannot be removed.')
    if (this.bootstrapPath && dirname(this.bootstrapPath) === old) {
      for (const name of ['database.sqlite', 'database.sqlite-wal', 'database.sqlite-shm', 'assets', 'config'])
        rmSync(join(old, name), { recursive: name === 'assets' || name === 'config', force: true })
    } else rmSync(old, { recursive: true, force: true })
    if (this.bootstrapPath) {
      const temporary = `${this.bootstrapPath}.${randomUUID()}.tmp`
      writeFileSync(temporary, JSON.stringify({ activeRoot: this.libraryRoot, previousRoot: null }), { mode: 0o600 })
      renameSync(temporary, this.bootstrapPath)
    }
    this.migration = { state: 'idle', destination: null, error: null }
  }
  diagnostics() {
    return this.jobs.diagnostics()
  }
  listErrors(filter?: import('../../shared/domain').ErrorEventFilter) {
    return this.errors.list(filter)
  }
  getError(id: string) {
    return this.errors.get(id)
  }
  reportRendererError(report: import('../../shared/domain').RendererErrorReport) {
    this.errors.reportRenderer(report)
  }
  exportDiagnostics(destination: string) {
    return this.jobs.exportDiagnostics(destination)
  }
  /** Import is deliberately copy-on-import: archive IDs never enter the live database. */
  importLossless(archivePath: string): ImportResult {
    this.assertWritable()
    let archive: Record<string, any>
    try {
      archive = JSON.parse(readFileSync(archivePath, 'utf8')) as Record<string, any>
    } catch {
      throw new Error('The selected file is not a readable lossless notebook archive.')
    }
    const lists = ['pages', 'notes', 'blocks', 'assets', 'relations', 'runs', 'segments', 'sources', 'blockSources']
    const root = resolve(archivePath, '..')
    validateLosslessArchive(archive, root)
    const all = [archive.notebook, ...lists.flatMap((key) => archive[key])]
    if (
      all.some(
        (item) => !item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.id)
      )
    )
      throw new Error('The archive contains invalid record identifiers.')
    const unique = (items: any[]) => new Set(items.map((item) => item.id)).size === items.length
    if (!lists.every((key) => unique(archive[key])) || !unique([archive.notebook]))
      throw new Error('The archive contains duplicate identifiers.')
    const assetById = new Map<string, any>(archive.assets.map((asset: any) => [asset.id, asset]))
    const copied: string[] = []
    // All archive bytes live in a private staging directory until every manifest check has passed.
    const stagingDirectory = join(this.assetsDirectory, `.import-${randomUUID()}.staging`)
    const maps = new Map<string, Map<string, string>>()
    for (const key of ['notebook', ...lists]) maps.set(key, new Map())
    maps.get('notebook')!.set(archive.notebook.id, randomUUID())
    lists.forEach((key) => archive[key].forEach((row: any) => maps.get(key)!.set(row.id, randomUUID())))
    const lookup = (key: string, id: unknown): string => {
      const value = maps.get(key)?.get(String(id))
      if (!value) throw new Error('The archive has a broken internal reference.')
      return value
    }
    const remap = (value: any): any => {
      if (Array.isArray(value)) return value.map(remap)
      if (!value || typeof value !== 'object') return value
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          const table =
            key === 'assetId'
              ? 'assets'
              : key === 'sourceDocumentId'
                ? 'sources'
                : key === 'activeTranscriptionRunId'
                  ? 'runs'
                  : null
          return [key, table && typeof item === 'string' ? lookup(table, item) : remap(item)]
        })
      )
    }
    // Validate hierarchy and every reference before any archive byte is copied.
    const ids = (key: string) => new Set(archive[key].map((row: any) => row.id))
    const pageIds = ids('pages')
    const noteIds = ids('notes')
    const blockIds = ids('blocks')
    const runIds = ids('runs')
    const sourceIds = ids('sources')
    if (
      archive.pages.some((row: any) => row.notebook_id !== archive.notebook.id) ||
      archive.notes.some((row: any) => !pageIds.has(row.page_id)) ||
      archive.blocks.some((row: any) => !noteIds.has(row.note_id) || typeof row.type !== 'string') ||
      archive.relations.some((row: any) => !blockIds.has(row.from_block_id) || !blockIds.has(row.to_block_id)) ||
      archive.runs.some((row: any) => !blockIds.has(row.block_id) || !assetById.has(row.asset_id)) ||
      archive.segments.some((row: any) => !runIds.has(row.run_id)) ||
      archive.sources.some((row: any) => !assetById.has(row.asset_id)) ||
      archive.blockSources.some((row: any) => !blockIds.has(row.block_id) || !sourceIds.has(row.source_document_id))
    )
      throw new Error('The archive has a broken hierarchy or internal reference.')
    for (const key of ['pages', 'notes', 'blocks', 'segments']) {
      const grouped = new Map<string, number[]>()
      const parent =
        key === 'pages' ? 'notebook_id' : key === 'notes' ? 'page_id' : key === 'blocks' ? 'note_id' : 'run_id'
      archive[key].forEach((row: any) => {
        const values = grouped.get(String(row[parent])) ?? []
        values.push(row.position)
        grouped.set(String(row[parent]), values)
      })
      if (
        [...grouped.values()].some(
          (values) => values.some((position) => !Number.isInteger(position)) || new Set(values).size !== values.length
        )
      )
        throw new Error('The archive has invalid ordering.')
    }
    try {
      mkdirSync(stagingDirectory, { recursive: true })
      for (const asset of archive.assets) {
        if (
          typeof asset.exportPath !== 'string' ||
          asset.exportPath.includes('\\') ||
          asset.exportPath.startsWith('/') ||
          asset.exportPath.split('/').includes('..') ||
          !asset.exportPath.startsWith('assets/')
        )
          throw new Error('The archive contains an unsafe asset path.')
        const source = resolve(root, asset.exportPath)
        if (!source.startsWith(`${root}/`) || !existsSync(source)) throw new Error('An archive asset is missing.')
        const expected = typeof asset.sha256 === 'string' ? asset.sha256 : null
        const bytes = readFileSync(source)
        if (!expected || createHash('sha256').update(bytes).digest('hex') !== expected)
          throw new Error('An archive asset failed its integrity check.')
        const extension = extname(asset.original_filename ?? asset.exportPath) || '.bin'
        const staged = join(stagingDirectory, `${lookup('assets', asset.id)}${extension}`)
        copyFileSync(source, staged)
      }
      // Publish only staged, already-verified assets. Database insertion is still one transaction.
      for (const asset of archive.assets) {
        const extension = extname(asset.original_filename ?? asset.exportPath) || '.bin'
        const folder =
          asset.kind === 'image'
            ? 'images'
            : asset.kind === 'screenshot'
              ? 'screenshots'
              : asset.kind === 'audio'
                ? 'audio'
                : 'files'
        const target = this.absoluteAssetPath(`assets/${folder}/${lookup('assets', asset.id)}${extension}`)
        renameSync(join(stagingDirectory, `${lookup('assets', asset.id)}${extension}`), target)
        copied.push(target)
      }
      const importedAt = now()
      const notebookId = lookup('notebook', archive.notebook.id)
      this.db.transaction(() => {
        this.db
          .prepare('INSERT INTO notebooks (id,title,created_at,updated_at) VALUES (?,?,?,?)')
          .run(notebookId, String(archive.notebook.title ?? 'Imported notebook'), importedAt, importedAt)
        const pageInsert = this.db.prepare(
          'INSERT INTO pages (id,notebook_id,title,position,created_at,updated_at) VALUES (?,?,?,?,?,?)'
        )
        archive.pages
          .sort((a: any, b: any) => a.position - b.position)
          .forEach((row: any, position: number) =>
            pageInsert.run(
              lookup('pages', row.id),
              notebookId,
              String(row.title ?? 'Untitled page'),
              position,
              importedAt,
              importedAt
            )
          )
        const noteInsert = this.db.prepare(
          'INSERT INTO notes (id,page_id,title,position,created_at,updated_at) VALUES (?,?,?,?,?,?)'
        )
        archive.notes
          .sort((a: any, b: any) => a.position - b.position)
          .forEach((row: any) =>
            noteInsert.run(
              lookup('notes', row.id),
              lookup('pages', row.page_id),
              String(row.title ?? 'Untitled note'),
              row.position,
              importedAt,
              importedAt
            )
          )
        const assetInsert = this.db.prepare(
          'INSERT INTO assets (id,notebook_id,kind,relative_path,original_filename,mime_type,byte_size,sha256,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
        )
        archive.assets.forEach((row: any) => {
          const id = lookup('assets', row.id)
          const folder =
            row.kind === 'image'
              ? 'images'
              : row.kind === 'screenshot'
                ? 'screenshots'
                : row.kind === 'audio'
                  ? 'audio'
                  : 'files'
          const extension = extname(row.original_filename ?? row.exportPath) || '.bin'
          assetInsert.run(
            id,
            notebookId,
            row.kind,
            `assets/${folder}/${id}${extension}`,
            row.original_filename ?? null,
            row.mime_type ?? null,
            row.byte_size ?? null,
            row.sha256,
            JSON.stringify({ ...safeJson(row.metadata_json), importedFromId: row.id }),
            importedAt,
            importedAt
          )
        })
        const sourceInsert = this.db.prepare(
          'INSERT INTO source_documents (id,notebook_id,asset_id,title,source_type,relative_path,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
        )
        const assetPathFor = this.db.prepare('SELECT relative_path FROM assets WHERE id=?')
        archive.sources.forEach((row: any) => {
          const asset = assetById.get(row.asset_id)
          if (!asset) throw new Error('The archive has a source with a missing asset.')
          const newAsset = lookup('assets', row.asset_id)
          const assetRow = assetPathFor.get(newAsset) as { relative_path: string } | undefined
          if (!assetRow) throw new Error('The archive source asset could not be copied.')
          sourceInsert.run(
            lookup('sources', row.id),
            notebookId,
            newAsset,
            String(row.title ?? 'Source'),
            row.source_type ?? 'pdf',
            assetRow.relative_path,
            JSON.stringify({ ...safeJson(row.metadata_json), importedFromId: row.id }),
            importedAt,
            importedAt
          )
        })
        const blockInsert = this.db.prepare(
          'INSERT INTO blocks (id,note_id,type,position,data_json,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)'
        )
        archive.blocks
          .sort((a: any, b: any) => a.position - b.position)
          .forEach((row: any) =>
            blockInsert.run(
              lookup('blocks', row.id),
              lookup('notes', row.note_id),
              row.type,
              row.position,
              JSON.stringify(remap(safeJson(row.data_json))),
              JSON.stringify({ ...safeJson(row.metadata_json), importedFromId: row.id }),
              importedAt,
              importedAt
            )
          )
        const assetRef = this.db.prepare('INSERT INTO asset_references (asset_id,block_id,created_at) VALUES (?,?,?)')
        archive.blocks.forEach((row: any) => {
          const data = safeJson(row.data_json)
          if (typeof data.assetId === 'string')
            assetRef.run(lookup('assets', data.assetId), lookup('blocks', row.id), importedAt)
        })
        const relationInsert = this.db.prepare(
          'INSERT INTO block_relations (id,from_block_id,to_block_id,relation_type,metadata_json,created_at) VALUES (?,?,?,?,?,?)'
        )
        archive.relations.forEach((row: any) =>
          relationInsert.run(
            lookup('relations', row.id),
            lookup('blocks', row.from_block_id),
            lookup('blocks', row.to_block_id),
            row.relation_type,
            JSON.stringify({ ...safeJson(row.metadata_json), importedFromId: row.id }),
            importedAt
          )
        )
        const runInsert = this.db.prepare(
          'INSERT INTO transcription_runs (id,asset_id,block_id,provider,model,language,duration_ms,status,confidence,transcript_text,error_message,started_at,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )
        archive.runs.forEach((row: any) =>
          runInsert.run(
            lookup('runs', row.id),
            lookup('assets', row.asset_id),
            lookup('blocks', row.block_id),
            row.provider,
            row.model,
            row.language ?? null,
            row.duration_ms ?? null,
            row.status,
            row.confidence ?? null,
            row.transcript_text ?? null,
            row.error_message ?? null,
            row.started_at ?? null,
            row.completed_at ?? null,
            importedAt,
            importedAt
          )
        )
        const segmentInsert = this.db.prepare(
          'INSERT INTO transcription_segments (id,run_id,position,start_ms,end_ms,text,confidence) VALUES (?,?,?,?,?,?,?)'
        )
        archive.segments.forEach((row: any) => {
          if (!(Number.isInteger(row.position) && row.start_ms >= 0 && row.end_ms >= row.start_ms))
            throw new Error('The archive contains invalid transcription segments.')
          segmentInsert.run(
            lookup('segments', row.id),
            lookup('runs', row.run_id),
            row.position,
            row.start_ms,
            row.end_ms,
            String(row.text ?? ''),
            row.confidence ?? null
          )
        })
        const sourceBlockInsert = this.db.prepare(
          'INSERT INTO block_sources (id,block_id,source_document_id,selection_type,pdf_page,printed_page,bounds_json,extracted_text,created_at) VALUES (?,?,?,?,?,?,?,?,?)'
        )
        archive.blockSources.forEach((row: any) =>
          sourceBlockInsert.run(
            lookup('blockSources', row.id),
            lookup('blocks', row.block_id),
            lookup('sources', row.source_document_id),
            row.selection_type,
            row.pdf_page ?? null,
            row.printed_page ?? null,
            row.bounds_json ?? null,
            row.extracted_text ?? null,
            importedAt
          )
        )
        this.refreshSearchIndex()
      })()
      return {
        notebook: asNotebook(this.db.prepare('SELECT * FROM notebooks WHERE id=?').get(notebookId) as NotebookRow),
        importedAssets: archive.assets.length
      }
    } catch (error) {
      copied.forEach((path) => rmSync(path, { force: true }))
      throw error
    } finally {
      rmSync(stagingDirectory, { recursive: true, force: true })
    }
  }
  removeAsset(assetId: string): void {
    this.assertWritable()
    const asset = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as AssetRow | undefined
    if (!asset) throw missing('Asset', assetId)
    const blockReferences = this.db
      .prepare('SELECT COUNT(*) AS count FROM asset_references WHERE asset_id = ?')
      .get(assetId) as { count: number }
    const sourceReferences = this.db
      .prepare('SELECT COUNT(*) AS count FROM source_documents WHERE asset_id = ?')
      .get(assetId) as { count: number }
    const exportReferences = this.db
      .prepare('SELECT COUNT(*) AS count FROM export_asset_references WHERE asset_id = ?')
      .get(assetId) as { count: number }
    if (blockReferences.count || sourceReferences.count || exportReferences.count)
      throw new Error(
        'This asset is still referenced by blocks, source documents, or an export record and cannot be removed.'
      )
    this.thumbnails.remove(assetId)
    this.db.transaction(() => this.db.prepare('DELETE FROM assets WHERE id = ?').run(assetId))()
    rmSync(this.absoluteAssetPath(asset.relative_path), { force: true })
  }
  diagnoseAssets(notebookId: string): AssetDiagnostics {
    const assets = this.listAssets(notebookId)
    const known = new Set(assets.map(({ relativePath }) => relativePath))
    const files = ['images', 'screenshots', 'audio', 'files'].flatMap((folder) => {
      const directory = join(this.assetsDirectory, folder)
      return existsSync(directory)
        ? readdirSync(directory)
            .filter((name) => !name.endsWith('.tmp'))
            .map((name) => `assets/${folder}/${name}`)
        : []
    })
    return {
      missing: assets.filter(({ relativePath }) => !existsSync(this.absoluteAssetPath(relativePath))),
      orphaned: assets.filter(
        (asset) =>
          (
            this.db.prepare('SELECT COUNT(*) AS count FROM asset_references WHERE asset_id = ?').get(asset.id) as {
              count: number
            }
          ).count === 0 && !this.db.prepare('SELECT 1 FROM source_documents WHERE asset_id = ?').get(asset.id)
      ),
      untrackedFiles: files.filter((file) => !known.has(file)),
      hashMismatched: [],
      scanJobId: null
    }
  }

  private async backupLibrary(
    destination: string,
    progress: (value: number) => void,
    cancelled: () => boolean
  ): Promise<Record<string, unknown>> {
    const id = randomUUID()
    const staging = join(destination, `.research-notebook-backup-${id}.tmp`)
    const final = join(destination, `research-notebook-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    mkdirSync(staging, { recursive: true })
    const backupAssets = join(staging, 'assets')
    mkdirSync(backupAssets, { recursive: true })
    try {
      if (this.databasePath === ':memory:') throw new Error('A disk-backed library is required for a backup.')
      // SQLite produces a consistent snapshot even while the application is open.
      this.db.exec(`VACUUM INTO '${join(staging, 'database.sqlite').replace(/'/g, "''")}'`)
      const assets = this.listAssetsForBackup()
      const manifest: Array<{ path: string; sha256: string }> = []
      for (let index = 0; index < assets.length; index += 1) {
        if (cancelled()) throw new Error('Cancelled')
        const asset = assets[index]
        const source = this.absoluteAssetPath(asset.relativePath)
        if (!existsSync(source)) throw new Error('Backup stopped: a managed asset is missing.')
        const target = join(backupAssets, asset.relativePath.replace(/^assets\//, ''))
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(source, target)
        const hash = createHash('sha256').update(readFileSync(target)).digest('hex')
        if (hash !== asset.sha256) throw new Error('Backup stopped: an asset hash did not verify.')
        manifest.push({ path: asset.relativePath, sha256: hash })
        progress(((index + 1) / Math.max(assets.length, 1)) * 90)
      }
      writeFileSync(
        join(staging, 'manifest.json'),
        JSON.stringify({ schemaVersion: 1, applicationVersion: '0.1.0', assets: manifest }, null, 2)
      )
      writeFileSync(
        join(staging, 'RECOVERY.md'),
        'Recovery instructions\n\n1. Close Research Notebook.\n2. Preserve the current database.sqlite; never overwrite it automatically.\n3. Copy this backup database.sqlite and assets directory into the app data directory.\n4. Verify manifest.json hashes before opening the app.\nIf a migration fails, keep the failed database for support or recovery and restore only a verified backup.\n'
      )
      renameSync(staging, final)
      progress(100)
      return { directory: final }
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      throw error
    }
  }
  private listAssetsForBackup(): Asset[] {
    return (this.db.prepare('SELECT * FROM assets').all() as AssetRow[]).map(asAsset)
  }

  /** Copy into a sibling staging directory; only the final pointer is written after every check passes. */
  private async moveLibrary(
    destination: string,
    progress: (value: number) => void,
    cancelled: () => boolean
  ): Promise<Record<string, unknown>> {
    const parent = resolve(destination)
    const target = join(parent, `research-notebook-library-${Date.now()}`)
    const staging = `${target}.staging-${randomUUID()}`
    if (
      directoryContains(physicalPath(this.libraryRoot), physicalPath(target)) ||
      directoryContains(physicalPath(target), physicalPath(this.libraryRoot))
    ) {
      this.migration = { state: 'failed', destination: target, error: 'Choose a location outside the current library.' }
      throw new Error('Choose a location outside the current library.')
    }
    this.migration = { state: 'copying', destination: target, error: null }
    let published = false
    let pointerTemporary: string | null = null
    try {
      mkdirSync(staging, { recursive: true })
      progress(5)
      if (cancelled()) throw new Error('Cancelled')
      this.db.exec(`VACUUM INTO '${join(staging, 'database.sqlite').replace(/'/g, "''")}'`)
      progress(25)
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (cancelled()) throw new Error('Cancelled')
      if (existsSync(this.assetsDirectory)) cpSync(this.assetsDirectory, join(staging, 'assets'), { recursive: true })
      progress(60)
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (cancelled()) throw new Error('Cancelled')
      if (existsSync(this.configDirectory)) cpSync(this.configDirectory, join(staging, 'config'), { recursive: true })
      const copiedAssets = join(staging, 'assets')
      for (const asset of this.listAssetsForBackup()) {
        if (cancelled()) throw new Error('Cancelled')
        const file = join(copiedAssets, asset.relativePath.replace(/^assets\//, ''))
        if (
          !existsSync(file) ||
          !asset.sha256 ||
          createHash('sha256').update(readFileSync(file)).digest('hex') !== asset.sha256
        )
          throw new Error('Library move verification failed for a managed asset.')
      }
      for (const model of WhisperModelManager.catalog) {
        const file = join(staging, 'config', 'whisper-models', model.id)
        if (existsSync(file) && createHash('sha256').update(readFileSync(file)).digest('hex') !== model.sha256)
          throw new Error('Library move verification failed for a Whisper model.')
      }
      // The snapshot is a separate SQLite file; integrity_check detects a damaged copy before activation.
      const snapshot = new NotebookDatabase(join(staging, 'database.sqlite'))
      try {
        const integrity = snapshot.connection.prepare('PRAGMA integrity_check').get() as { integrity_check?: string }
        if (integrity.integrity_check !== 'ok')
          throw new Error('Library move verification failed for the database snapshot.')
        snapshot.connection
          .prepare(
            "UPDATE jobs SET status='completed',progress=100,result_json=?,completed_at=?,updated_at=? WHERE kind='library-move' AND status='running'"
          )
          .run(JSON.stringify({ destination: target, restartRequired: true }), now(), now())
      } finally {
        snapshot.close()
      }
      progress(90)
      if (cancelled()) throw new Error('Cancelled')
      renameSync(staging, target)
      published = true
      if (!this.bootstrapPath) throw new Error('This installation cannot activate a relocated library.')
      pointerTemporary = `${this.bootstrapPath}.${randomUUID()}.tmp`
      writeFileSync(pointerTemporary, JSON.stringify({ activeRoot: target, previousRoot: this.libraryRoot }), {
        mode: 0o600
      })
      renameSync(pointerTemporary, this.bootstrapPath)
      this.migration = { state: 'pending-restart', destination: target, error: null }
      progress(100)
      return { destination: target, restartRequired: true }
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      if (pointerTemporary) rmSync(pointerTemporary, { force: true })
      // Do not leave a fully copied but inactive library behind if pointer
      // publication fails after the staging directory was promoted.
      if (published) rmSync(target, { recursive: true, force: true })
      this.migration = {
        state: 'failed',
        destination: target,
        error: error instanceof Error ? error.message : 'Library move failed.'
      }
      throw error
    }
  }
  private directoryBytes(directory: string): number {
    if (!existsSync(directory)) return 0
    return readdirSync(directory, { withFileTypes: true }).reduce(
      (total, entry) =>
        total +
        (entry.isDirectory()
          ? this.directoryBytes(join(directory, entry.name))
          : entry.isFile()
            ? statSync(join(directory, entry.name)).size
            : 0),
      0
    )
  }
  private jobPayloadModel(jobId: string): string | null {
    try {
      const row = this.db.prepare('SELECT payload_json FROM jobs WHERE id = ?').get(jobId) as
        { payload_json: string } | undefined
      const value = row ? (JSON.parse(row.payload_json) as { modelId?: unknown }) : {}
      return typeof value.modelId === 'string' ? value.modelId : null
    } catch {
      return null
    }
  }

  importPdf(notebookId: string, sourcePath: string): SourceDocument {
    this.assertWritable()
    const asset = this.importAsset(notebookId, 'file', sourcePath)
    if (asset.mimeType !== 'application/pdf') {
      this.removeAsset(asset.id)
      throw new Error('Only PDF documents can be opened in the PDF source viewer.')
    }
    const timestamp = now()
    const row: SourceRow = {
      id: randomUUID(),
      notebook_id: notebookId,
      asset_id: asset.id,
      title: asset.originalFilename ?? 'Untitled PDF',
      source_type: 'pdf',
      relative_path: asset.relativePath,
      metadata_json: JSON.stringify({ sha256: asset.sha256 }),
      created_at: timestamp,
      updated_at: timestamp
    }
    this.db
      .prepare(
        'INSERT INTO source_documents (id, notebook_id, asset_id, title, source_type, relative_path, metadata_json, created_at, updated_at) VALUES (@id, @notebook_id, @asset_id, @title, @source_type, @relative_path, @metadata_json, @created_at, @updated_at)'
      )
      .run(row)
    return asSource(row)
  }
  listSources(notebookId: string): SourceDocument[] {
    this.requireActive('notebook', notebookId)
    return (
      this.db
        .prepare(
          "SELECT * FROM source_documents WHERE notebook_id = ? AND source_type = 'pdf' ORDER BY updated_at DESC"
        )
        .all(notebookId) as SourceRow[]
    ).map(asSource)
  }
  getBlockSource(blockId: string): BlockSource | null {
    this.requireActive('block', blockId)
    const row = this.db
      .prepare('SELECT * FROM block_sources WHERE block_id = ? ORDER BY created_at LIMIT 1')
      .get(blockId) as SourceBlockRow | undefined
    return row ? asBlockSource(row) : null
  }
  captureSourceText(
    noteId: string,
    sourceDocumentId: string,
    pdfPage: number,
    printedPage: number | undefined,
    text: string
  ): Block {
    this.assertWritable()
    if (!text.trim()) throw new Error('Select or enter text to capture.')
    const source = this.requireSourceForNote(noteId, sourceDocumentId)
    const block = this.createBlock(noteId, 'source_text', {
      text,
      sourceDocumentId: source.id,
      pdfPage,
      printedPage: printedPage ?? null
    })
    this.insertBlockSource(block.id, sourceDocumentId, 'text', pdfPage, printedPage, null, text)
    return block
  }
  captureSourceRegion(
    noteId: string,
    sourceDocumentId: string,
    pdfPage: number,
    bounds: { x: number; y: number; width: number; height: number },
    imageDataUrl: string
  ): Block {
    this.assertWritable()
    this.requireSourceForNote(noteId, sourceDocumentId)
    if (
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    )
      throw new Error('Region bounds must be finite positive dimensions.')
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(imageDataUrl)
    if (!match) throw new Error('A PNG, JPEG, or WebP screenshot is required.')
    const source = this.db.prepare('SELECT notebook_id FROM source_documents WHERE id = ?').get(sourceDocumentId) as {
      notebook_id: string
    }
    const imagePath = this.writeBytes(
      'screenshots',
      match[2],
      match[1] === 'image/png' ? '.png' : match[1] === 'image/jpeg' ? '.jpg' : '.webp'
    )
    const asset = this.insertWrittenAsset(
      source.notebook_id,
      'screenshot',
      imagePath,
      `PDF page ${pdfPage} region`,
      match[1]
    )
    const block = this.attachAsset(noteId, asset.id, 'screenshot')
    this.insertBlockSource(block.id, sourceDocumentId, 'region', pdfPage, undefined, bounds, null)
    return block
  }
  createQaNote(
    pageId: string,
    sourceDocumentId: string,
    pdfPage: number,
    printedPage: number | undefined,
    text: string
  ): Note {
    this.assertWritable()
    const note = this.createNote(pageId, 'Q&A from source selection')
    const source = this.requireSourceForNote(note.id, sourceDocumentId)
    const question = this.createBlock(note.id, 'question', {
      text,
      sourceDocumentId: source.id,
      pdfPage,
      printedPage: printedPage ?? null
    })
    this.insertBlockSource(question.id, sourceDocumentId, 'text', pdfPage, printedPage, null, text)
    const answer = this.createBlock(note.id, 'answer', { text: '' })
    this.createRelation(answer.id, question.id, 'responds_to')
    return note
  }

  moveToTrash(entityType: TrashEntityType, id: string): TrashRecord {
    this.assertWritable()
    return this.db.transaction(() => {
      const root = this.activeRow(entityType, id) as NotebookRow | PageRow | NoteRow | BlockRow
      const deletedAt = now()
      const operationId = randomUUID()
      this.cascadeTrash(entityType, id, deletedAt, operationId)
      this.refreshSearchIndex()
      return { entityType, id, title: this.rowTitle(entityType, root), deletedAt, deletionOperationId: operationId }
    })()
  }

  listTrash(): TrashRecord[] {
    const rows = this.db
      .prepare(
        `
      SELECT 'notebook' AS entity_type, id, title, deleted_at, deletion_operation_id FROM notebooks WHERE deleted_at IS NOT NULL
      UNION ALL
      SELECT 'page', p.id, p.title, p.deleted_at, p.deletion_operation_id FROM pages p WHERE p.deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notebooks n WHERE n.id = p.notebook_id AND n.deletion_operation_id = p.deletion_operation_id)
      UNION ALL
      SELECT 'note', n.id, n.title, n.deleted_at, n.deletion_operation_id FROM notes n WHERE n.deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.id = n.page_id AND p.deletion_operation_id = n.deletion_operation_id)
      UNION ALL
      SELECT 'block', b.id, b.type, b.deleted_at, b.deletion_operation_id FROM blocks b WHERE b.deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = b.note_id AND n.deletion_operation_id = b.deletion_operation_id)
      ORDER BY deleted_at DESC
    `
      )
      .all() as Array<{
      entity_type: TrashEntityType
      id: string
      title: string
      deleted_at: string
      deletion_operation_id: string
    }>
    return rows.map((row) => ({
      entityType: row.entity_type,
      id: row.id,
      title: row.title,
      deletedAt: row.deleted_at,
      deletionOperationId: row.deletion_operation_id
    }))
  }

  restoreFromTrash(entityType: TrashEntityType, id: string, operationId: string): void {
    this.assertWritable()
    this.db.transaction(() => {
      const root = this.deletedRow(entityType, id, operationId)
      this.ensureRestoreParentActive(entityType, root)
      this.cascadeRestore(entityType, id, operationId, now())
      this.refreshSearchIndex()
    })()
  }

  permanentlyDelete(entityType: TrashEntityType, id: string): void {
    this.assertWritable()
    this.db.transaction(() => {
      if (!this.db.prepare(`SELECT id FROM ${this.table(entityType)} WHERE id = ? AND deleted_at IS NOT NULL`).get(id))
        throw missing(entityType[0].toUpperCase() + entityType.slice(1), id)
      this.db.prepare(`DELETE FROM ${this.table(entityType)} WHERE id = ?`).run(id)
      this.refreshSearchIndex()
    })()
  }

  emptyTrash(): void {
    this.assertWritable()
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM notebooks WHERE deleted_at IS NOT NULL').run()
      this.db.prepare('DELETE FROM pages WHERE deleted_at IS NOT NULL').run()
      this.db.prepare('DELETE FROM notes WHERE deleted_at IS NOT NULL').run()
      this.db.prepare('DELETE FROM blocks WHERE deleted_at IS NOT NULL').run()
      this.refreshSearchIndex()
    })()
  }

  search(query: string): SearchResult[] {
    const fts = this.ftsQuery(query)
    if (!fts) return []
    const rows = this.db
      .prepare(
        `SELECT entity_type, entity_id, notebook_id, page_id, note_id,
      CASE entity_type WHEN 'note' THEN (SELECT position FROM notes WHERE id = search_index.entity_id)
        WHEN 'block' THEN (SELECT notes.position FROM blocks JOIN notes ON notes.id = blocks.note_id WHERE blocks.id = search_index.entity_id) END AS note_position,
      title, snippet(search_index, 6, '', '', '…', 14) AS excerpt FROM search_index WHERE search_index MATCH ? ORDER BY bm25(search_index) LIMIT 100`
      )
      .all(fts) as SearchRow[]
    return rows.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      notebookId: row.notebook_id,
      pageId: row.page_id,
      noteId: row.note_id,
      blockId: row.entity_type === 'block' ? row.entity_id : null,
      notePosition: row.note_position,
      title: row.title,
      excerpt: row.excerpt
    }))
  }

  private refreshSearchIndex(): void {
    this.db.prepare('DELETE FROM search_index').run()
    this.db
      .prepare(
        `INSERT INTO search_index (entity_type, entity_id, notebook_id, page_id, note_id, title, content)
      SELECT 'notebook', id, id, NULL, NULL, title, title FROM notebooks WHERE deleted_at IS NULL`
      )
      .run()
    this.db
      .prepare(
        `INSERT INTO search_index (entity_type, entity_id, notebook_id, page_id, note_id, title, content)
      SELECT 'page', p.id, p.notebook_id, p.id, NULL, p.title, p.title FROM pages p JOIN notebooks n ON n.id = p.notebook_id WHERE p.deleted_at IS NULL AND n.deleted_at IS NULL`
      )
      .run()
    this.db
      .prepare(
        `INSERT INTO search_index (entity_type, entity_id, notebook_id, page_id, note_id, title, content)
      SELECT 'note', notes.id, pages.notebook_id, notes.page_id, notes.id, notes.title, notes.title FROM notes JOIN pages ON pages.id = notes.page_id JOIN notebooks ON notebooks.id = pages.notebook_id WHERE notes.deleted_at IS NULL AND pages.deleted_at IS NULL AND notebooks.deleted_at IS NULL`
      )
      .run()
    this.db
      .prepare(
        `INSERT INTO search_index (entity_type, entity_id, notebook_id, page_id, note_id, title, content)
      SELECT 'block', blocks.id, pages.notebook_id, notes.page_id, blocks.note_id, blocks.type, blocks.data_json FROM blocks JOIN notes ON notes.id = blocks.note_id JOIN pages ON pages.id = notes.page_id JOIN notebooks ON notebooks.id = pages.notebook_id WHERE blocks.deleted_at IS NULL AND notes.deleted_at IS NULL AND pages.deleted_at IS NULL AND notebooks.deleted_at IS NULL`
      )
      .run()
  }

  private cascadeTrash(type: TrashEntityType, id: string, deletedAt: string, operationId: string): void {
    const trash = (table: string, where: string, params: unknown[] = []) =>
      this.db
        .prepare(
          `UPDATE ${table} SET deleted_at = ?, deletion_operation_id = ?, updated_at = ? WHERE deleted_at IS NULL AND ${where}`
        )
        .run(deletedAt, operationId, deletedAt, ...params)
    if (type === 'notebook') {
      trash(
        'blocks',
        'note_id IN (SELECT notes.id FROM notes JOIN pages ON pages.id = notes.page_id WHERE pages.notebook_id = ? AND notes.deleted_at IS NULL AND pages.deleted_at IS NULL)',
        [id]
      )
      trash('notes', 'page_id IN (SELECT id FROM pages WHERE notebook_id = ? AND deleted_at IS NULL)', [id])
      trash('pages', 'notebook_id = ?', [id])
      trash('notebooks', 'id = ?', [id])
    }
    if (type === 'page') {
      trash('blocks', 'note_id IN (SELECT id FROM notes WHERE page_id = ? AND deleted_at IS NULL)', [id])
      trash('notes', 'page_id = ?', [id])
      trash('pages', 'id = ?', [id])
    }
    if (type === 'note') {
      trash('blocks', 'note_id = ?', [id])
      trash('notes', 'id = ?', [id])
    }
    if (type === 'block') trash('blocks', 'id = ?', [id])
  }

  private cascadeRestore(type: TrashEntityType, id: string, operationId: string, updatedAt: string): void {
    const restore = (table: string, where: string, params: unknown[] = []) =>
      this.db
        .prepare(
          `UPDATE ${table} SET deleted_at = NULL, deletion_operation_id = NULL, updated_at = ? WHERE deletion_operation_id = ? AND ${where}`
        )
        .run(updatedAt, operationId, ...params)
    if (type === 'notebook') {
      restore('notebooks', 'id = ?', [id])
      restore('pages', 'notebook_id = ?', [id])
      restore('notes', 'page_id IN (SELECT id FROM pages WHERE notebook_id = ?)', [id])
      restore(
        'blocks',
        'note_id IN (SELECT notes.id FROM notes JOIN pages ON pages.id = notes.page_id WHERE pages.notebook_id = ?)',
        [id]
      )
    }
    if (type === 'page') {
      restore('pages', 'id = ?', [id])
      restore('notes', 'page_id = ?', [id])
      restore('blocks', 'note_id IN (SELECT id FROM notes WHERE page_id = ?)', [id])
    }
    if (type === 'note') {
      restore('notes', 'id = ?', [id])
      restore('blocks', 'note_id = ?', [id])
    }
    if (type === 'block') restore('blocks', 'id = ?', [id])
  }

  private ensureRestoreParentActive(type: TrashEntityType, row: NotebookRow | PageRow | NoteRow | BlockRow): void {
    if (
      type === 'page' &&
      !this.db.prepare('SELECT id FROM notebooks WHERE id = ? AND deleted_at IS NULL').get((row as PageRow).notebook_id)
    )
      throw new Error('Restore the parent notebook before restoring this page.')
    if (
      type === 'note' &&
      !this.db.prepare('SELECT id FROM pages WHERE id = ? AND deleted_at IS NULL').get((row as NoteRow).page_id)
    )
      throw new Error('Restore the parent page before restoring this note.')
    if (
      type === 'block' &&
      !this.db.prepare('SELECT id FROM notes WHERE id = ? AND deleted_at IS NULL').get((row as BlockRow).note_id)
    )
      throw new Error('Restore the parent note before restoring this block.')
  }

  private activeRow(type: TrashEntityType, id: string): NotebookRow | PageRow | NoteRow | BlockRow {
    const row = this.db.prepare(`SELECT * FROM ${this.table(type)} WHERE id = ? AND deleted_at IS NULL`).get(id) as
      NotebookRow | PageRow | NoteRow | BlockRow | undefined
    if (!row) throw missing(type[0].toUpperCase() + type.slice(1), id)
    if (type !== 'notebook') this.requireActiveParent(type, row as PageRow | NoteRow | BlockRow)
    return row
  }
  private deletedRow(
    type: TrashEntityType,
    id: string,
    operationId: string
  ): NotebookRow | PageRow | NoteRow | BlockRow {
    const row = this.db
      .prepare(`SELECT * FROM ${this.table(type)} WHERE id = ? AND deletion_operation_id = ?`)
      .get(id, operationId) as NotebookRow | PageRow | NoteRow | BlockRow | undefined
    if (!row) throw missing(type[0].toUpperCase() + type.slice(1), id)
    return row
  }
  private requireActive(type: TrashEntityType, id: string): void {
    this.activeRow(type, id)
  }
  private requireActiveParent(type: Exclude<TrashEntityType, 'notebook'>, row: PageRow | NoteRow | BlockRow): void {
    if (
      type === 'page' &&
      !this.db.prepare('SELECT id FROM notebooks WHERE id = ? AND deleted_at IS NULL').get((row as PageRow).notebook_id)
    )
      throw missing('Page', row.id)
    if (
      type === 'note' &&
      !this.db
        .prepare(
          'SELECT notes.id FROM notes JOIN pages ON pages.id = notes.page_id JOIN notebooks ON notebooks.id = pages.notebook_id WHERE notes.id = ? AND pages.deleted_at IS NULL AND notebooks.deleted_at IS NULL'
        )
        .get(row.id)
    )
      throw missing('Note', row.id)
    if (
      type === 'block' &&
      !this.db
        .prepare(
          'SELECT blocks.id FROM blocks JOIN notes ON notes.id = blocks.note_id JOIN pages ON pages.id = notes.page_id JOIN notebooks ON notebooks.id = pages.notebook_id WHERE blocks.id = ? AND notes.deleted_at IS NULL AND pages.deleted_at IS NULL AND notebooks.deleted_at IS NULL'
        )
        .get(row.id)
    )
      throw missing('Block', row.id)
  }
  private blockNotebook(blockId: string): { notebook_id: string } | undefined {
    return this.db
      .prepare(
        'SELECT pages.notebook_id FROM blocks JOIN notes ON notes.id = blocks.note_id JOIN pages ON pages.id = notes.page_id JOIN notebooks ON notebooks.id = pages.notebook_id WHERE blocks.id = ? AND blocks.deleted_at IS NULL AND notes.deleted_at IS NULL AND pages.deleted_at IS NULL AND notebooks.deleted_at IS NULL'
      )
      .get(blockId) as { notebook_id: string } | undefined
  }
  private rowTitle(type: TrashEntityType, row: NotebookRow | PageRow | NoteRow | BlockRow): string {
    return type === 'block' ? (row as BlockRow).type : (row as NotebookRow | PageRow | NoteRow).title
  }
  private table(type: TrashEntityType): 'notebooks' | 'pages' | 'notes' | 'blocks' {
    return `${type}s` as 'notebooks' | 'pages' | 'notes' | 'blocks'
  }
  private nextPosition(
    table: 'pages' | 'notes' | 'blocks',
    foreignKey: 'notebook_id' | 'page_id' | 'note_id',
    parentId: string
  ): number {
    return (
      (
        this.db
          .prepare(`SELECT COALESCE(MAX(position), -1) AS max_position FROM ${table} WHERE ${foreignKey} = ?`)
          .get(parentId) as { max_position: number }
      ).max_position + 1
    )
  }
  private touchNoteNotebook(noteId: string, updatedAt: string): void {
    this.db
      .prepare(
        'UPDATE notebooks SET updated_at = ? WHERE id = (SELECT pages.notebook_id FROM notes JOIN pages ON pages.id = notes.page_id WHERE notes.id = ?)'
      )
      .run(updatedAt, noteId)
  }
  private touchNotebook(notebookId: string, updatedAt: string): void {
    this.db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').run(updatedAt, notebookId)
  }
  private ftsQuery(query: string): string {
    const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? []
    return terms.map((term) => `"${term.replace(/"/g, '')}"*`).join(' AND ')
  }
  private absoluteAssetPath(relativePath: string): string {
    const path = resolve(this.assetsDirectory, relativePath.replace(/^assets\//, ''))
    if (!path.startsWith(`${this.assetsDirectory}/`)) throw new Error('Invalid managed asset path.')
    return path
  }
  private mimeType(extension: string): string {
    return (
      (
        {
          '.pdf': 'application/pdf',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.m4a': 'audio/mp4'
        } as Record<string, string>
      )[extension] ?? 'application/octet-stream'
    )
  }
  private writeBytes(folder: 'screenshots' | 'audio', base64: string, extension: string): string {
    const file = `${randomUUID()}${extension}`
    const path = join(this.assetsDirectory, folder, file)
    const temporary = `${path}.${randomUUID()}.tmp`
    writeFileSync(temporary, Buffer.from(base64, 'base64'))
    renameSync(temporary, path)
    return `assets/${folder}/${file}`
  }
  private insertWrittenAsset(
    notebookId: string,
    kind: AssetKind,
    relativePath: string,
    filename: string,
    mimeType: string
  ): Asset {
    const path = this.absoluteAssetPath(relativePath)
    const timestamp = now()
    const bytes = readFileSync(path)
    const row: AssetRow = {
      id: randomUUID(),
      notebook_id: notebookId,
      kind,
      relative_path: relativePath,
      original_filename: filename,
      mime_type: mimeType,
      byte_size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      metadata_json: '{}',
      created_at: timestamp,
      updated_at: timestamp
    }
    this.db
      .prepare(
        'INSERT INTO assets (id, notebook_id, kind, relative_path, original_filename, mime_type, byte_size, sha256, metadata_json, created_at, updated_at) VALUES (@id, @notebook_id, @kind, @relative_path, @original_filename, @mime_type, @byte_size, @sha256, @metadata_json, @created_at, @updated_at)'
      )
      .run(row)
    return asAsset(row)
  }
  private requireSourceForNote(noteId: string, sourceDocumentId: string): SourceRow {
    const note = this.db
      .prepare(
        'SELECT pages.notebook_id FROM notes JOIN pages ON pages.id = notes.page_id WHERE notes.id = ? AND notes.deleted_at IS NULL'
      )
      .get(noteId) as { notebook_id: string } | undefined
    const source = this.db.prepare('SELECT * FROM source_documents WHERE id = ?').get(sourceDocumentId) as
      SourceRow | undefined
    if (!note || !source || note.notebook_id !== source.notebook_id)
      throw new Error('The source document must belong to the active note’s notebook.')
    return source
  }
  private insertBlockSource(
    blockId: string,
    sourceDocumentId: string,
    selectionType: 'text' | 'region',
    pdfPage: number,
    printedPage: number | undefined,
    bounds: BlockSource['bounds'],
    extractedText: string | null
  ): void {
    this.db
      .prepare(
        'INSERT INTO block_sources (id, block_id, source_document_id, selection_type, pdf_page, printed_page, bounds_json, extracted_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        randomUUID(),
        blockId,
        sourceDocumentId,
        selectionType,
        pdfPage,
        printedPage ?? null,
        bounds ? JSON.stringify(bounds) : null,
        extractedText,
        now()
      )
  }
}
