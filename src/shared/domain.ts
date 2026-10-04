export const blockTypes = [
  'text',
  'source_text',
  'commentary',
  'explanation',
  'question',
  'answer',
  'quote',
  'image',
  'screenshot',
  'audio',
  'transcript',
  'code',
  'table',
  'divider',
  'file'
] as const

export const textBlockTypes = [
  'text',
  'source_text',
  'commentary',
  'explanation',
  'question',
  'answer',
  'quote'
] as const
export const relationTypes = ['responds_to', 'explains', 'comments_on', 'summarizes'] as const

export type BlockType = (typeof blockTypes)[number]
export type TextBlockType = (typeof textBlockTypes)[number]
export type RelationType = (typeof relationTypes)[number]
export type TrashEntityType = 'notebook' | 'page' | 'note' | 'block'
export type SearchEntityType = TrashEntityType

export interface Deletable {
  deletedAt: string | null
  deletionOperationId: string | null
}
export interface Notebook extends Deletable {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}
export interface Page extends Deletable {
  id: string
  notebookId: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
}
export interface Note extends Deletable {
  id: string
  pageId: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
}
export interface Block extends Deletable {
  id: string
  noteId: string
  type: BlockType
  position: number
  data: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface BlockRelation {
  id: string
  fromBlockId: string
  toBlockId: string
  relationType: RelationType
  metadata: Record<string, unknown>
  createdAt: string
}

export type AssetKind = 'image' | 'screenshot' | 'audio' | 'file'
export interface Asset {
  id: string
  notebookId: string
  kind: AssetKind
  relativePath: string
  originalFilename: string | null
  mimeType: string | null
  byteSize: number | null
  sha256: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
export interface AssetDiagnostics {
  missing: Asset[]
  orphaned: Asset[]
  untrackedFiles: string[]
  hashMismatched: Asset[]
  scanJobId?: string | null
}
export interface SourceDocument {
  id: string
  notebookId: string
  title: string
  sourceType: 'pdf'
  relativePath: string
  assetId: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
export interface BlockSource {
  id: string
  blockId: string
  sourceDocumentId: string
  selectionType: 'text' | 'region'
  pdfPage: number | null
  printedPage: number | null
  bounds: { x: number; y: number; width: number; height: number } | null
  extractedText: string | null
  createdAt: string
}
export type TranscriptionProviderName = 'local' | 'openrouter'
export type TranscriptionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export interface TranscriptionSegment {
  id: string
  position: number
  startMs: number
  endMs: number
  text: string
  confidence: number | null
}
export interface TranscriptionRun {
  id: string
  assetId: string
  blockId: string
  provider: TranscriptionProviderName
  model: string
  language: string | null
  durationMs: number | null
  status: TranscriptionStatus
  confidence: number | null
  transcriptText: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  segments: TranscriptionSegment[]
}
export type ThemePreference = 'light' | 'dark' | 'system'
export type DensityPreference = 'default' | 'compact'
export interface AppPreferences {
  theme: ThemePreference
  density: DensityPreference
}
export interface WhisperModel {
  id: string
  displayName: string
  sizeBytes: number
  installed: boolean
  state: 'idle' | 'downloading' | 'ready' | 'failed'
  progress: number | null
  error: string | null
}
export interface TranscriptionSettings {
  openRouterConfigured: boolean
  localModels: string[]
  openRouterModels: string[]
  localBinaryAvailable: boolean
  localModelAvailable: boolean
  selectedLocalModel: { id: string; displayName: string; sizeBytes: number } | null
  localDownload: { state: 'idle' | 'downloading' | 'ready' | 'failed'; progress: number | null; error: string | null }
}
export interface StorageSummary {
  libraryPath: string
  databaseBytes: number
  assetsBytes: number
  modelsBytes: number
  oldLibraryPath: string | null
  migration: LibraryMigrationStatus
}
export interface LibraryMigrationStatus {
  state: 'idle' | 'copying' | 'pending-restart' | 'active' | 'failed'
  destination: string | null
  error: string | null
}
export type ExportFormat = 'markdown' | 'lossless-json' | 'ai-context' | 'pdf'
export type ExportScope =
  { type: 'notebook'; notebookId: string } | { type: 'page'; pageId: string } | { type: 'note'; noteId: string }
export interface ExportResult {
  id: string
  directory: string
  format: ExportFormat
  manifestPath: string
}
export type JobKind =
  'export' | 'pdf' | 'asset-integrity' | 'backup' | 'thumbnail' | 'transcription' | 'model-download' | 'library-move'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export interface Job {
  id: string
  kind: JobKind
  status: JobStatus
  progress: number
  errorMessage: string | null
  result: Record<string, unknown> | null
  attempts: number
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}
export interface DiagnosticEvent {
  category: string
  outcome: string
  code: string | null
  message: string | null
  durationMs: number | null
  createdAt: string
}
export type ErrorSeverity = 'warning' | 'error' | 'fatal'
export type ErrorProcess = 'renderer' | 'preload' | 'main' | 'service' | 'job' | 'lifecycle'
export interface ErrorEvent {
  id: string
  createdAt: string
  severity: ErrorSeverity
  process: ErrorProcess
  layer: string
  category: string
  code: string | null
  message: string
  stack: string | null
  causeChain: string | null
  context: Record<string, unknown>
  appVersion: string | null
  operationId: string | null
  ipcId: string | null
}
export interface ErrorEventFilter {
  process?: ErrorProcess
  category?: string
  severity?: ErrorSeverity
  limit?: number
}
export interface RendererErrorReport {
  severity?: ErrorSeverity
  category: string
  message: string
  stack?: string
  causeChain?: string
  context?: Record<string, unknown>
  operationId?: string
}
export interface ImportResult {
  notebook: Notebook
  importedAssets: number
}

export interface TrashRecord {
  entityType: TrashEntityType
  id: string
  title: string
  deletedAt: string
  deletionOperationId: string
}

export interface SearchResult {
  entityType: SearchEntityType
  entityId: string
  notebookId: string | null
  pageId: string | null
  noteId: string | null
  blockId: string | null
  notePosition: number | null
  title: string
  excerpt: string
}

export interface NotebookTree extends Notebook {
  pages: Page[]
}
export interface PageWorkspace extends Page {
  notes: Array<Note & { blocks: Block[] }>
  nextCursor: string | null
}

export interface ResearchNotebookApi {
  notebooks: {
    list(): Promise<NotebookTree[]>
    create(input: { title: string }): Promise<Notebook>
    update(input: { notebookId: string; title: string }): Promise<Notebook>
  }
  pages: {
    create(input: { notebookId: string; title: string }): Promise<Page>
    update(input: { pageId: string; title: string }): Promise<Page>
    getWorkspace(input: { pageId: string; cursor?: string }): Promise<PageWorkspace>
  }
  notes: {
    create(input: { pageId: string; title: string }): Promise<Note>
    update(input: { noteId: string; title: string }): Promise<Note>
    duplicate(input: { noteId: string }): Promise<Note>
  }
  blocks: {
    create(input: { noteId: string; type: BlockType; data?: Record<string, unknown> }): Promise<Block>
    update(input: { blockId: string; data: Record<string, unknown> }): Promise<Block>
    updateType(input: { blockId: string; type: TextBlockType }): Promise<Block>
    duplicate(input: { blockId: string }): Promise<Block>
    reorder(input: { noteId: string; blockIds: string[] }): Promise<void>
  }
  assets: {
    import(input: { notebookId: string; kind: AssetKind }): Promise<Asset | null>
    list(input: { notebookId: string }): Promise<Asset[]>
    dataUrl(input: { assetId: string }): Promise<string>
    attach(input: { noteId: string; assetId: string; type: 'image' | 'screenshot' | 'audio' | 'file' }): Promise<Block>
    diagnostics(input: { notebookId: string }): Promise<AssetDiagnostics>
    remove(input: { assetId: string }): Promise<void>
    saveRecording(input: { noteId: string; wavBase64: string; filename?: string }): Promise<Block>
    requestThumbnail(input: { assetId: string; width: number; height: number }): Promise<Job>
    thumbnailDataUrl(input: { assetId: string; width: number; height: number }): Promise<string | null>
  }
  transcription: {
    create(input: {
      blockId: string
      provider: TranscriptionProviderName
      model?: string
      language?: string
    }): Promise<Job | TranscriptionRun>
    get(input: { runId: string }): Promise<TranscriptionRun>
    list(input: { blockId: string }): Promise<TranscriptionRun[]>
    retry(input: { runId: string }): Promise<Job | TranscriptionRun>
  }
  settings: {
    preferences(): Promise<AppPreferences>
    updatePreferences(input: Partial<AppPreferences>): Promise<AppPreferences>
    transcription(): Promise<TranscriptionSettings>
    setOpenRouterKey(input: { key: string }): Promise<void>
    removeOpenRouterKey(): Promise<void>
    models(): Promise<WhisperModel[]>
    downloadModel(input: { modelId: string }): Promise<Job>
    cancelModelDownload(input: { modelId: string }): Promise<void>
    removeModel(input: { modelId: string }): Promise<void>
    setDefaultModel(input: { modelId: string }): Promise<void>
    storage(): Promise<StorageSummary>
    moveLibrary(): Promise<Job | null>
    migrationStatus(): Promise<LibraryMigrationStatus>
    removeOldLibrary(): Promise<void>
  }
  exports: { start(input: { scope: ExportScope; format: ExportFormat }): Promise<Job> }
  jobs: {
    list(): Promise<Job[]>
    cancel(input: { jobId: string }): Promise<Job>
    retry(input: { jobId: string }): Promise<Job>
  }
  backups: { start(): Promise<Job> }
  diagnostics: {
    list(): Promise<DiagnosticEvent[]>
    listErrors(input?: ErrorEventFilter): Promise<ErrorEvent[]>
    getError(input: { id: string }): Promise<ErrorEvent | null>
    reportError(input: RendererErrorReport): Promise<void>
    export(): Promise<string | null>
  }
  imports: { start(): Promise<ImportResult | null> }
  sources: {
    importPdf(input: { notebookId: string }): Promise<SourceDocument | null>
    list(input: { notebookId: string }): Promise<SourceDocument[]>
    getBlockSource(input: { blockId: string }): Promise<BlockSource | null>
    captureText(input: {
      noteId: string
      sourceDocumentId: string
      pdfPage: number
      printedPage?: number
      text: string
      selectionType?: 'text'
    }): Promise<Block>
    captureRegion(input: {
      noteId: string
      sourceDocumentId: string
      pdfPage: number
      bounds: { x: number; y: number; width: number; height: number }
      imageDataUrl: string
    }): Promise<Block>
    createQaNote(input: {
      pageId: string
      sourceDocumentId: string
      pdfPage: number
      printedPage?: number
      text: string
    }): Promise<Note>
  }
  relations: {
    list(input: { blockId: string }): Promise<BlockRelation[]>
    create(input: { fromBlockId: string; toBlockId: string; relationType: RelationType }): Promise<BlockRelation>
    remove(input: { relationId: string }): Promise<void>
  }
  trash: {
    list(): Promise<TrashRecord[]>
    move(input: { entityType: TrashEntityType; id: string }): Promise<TrashRecord>
    restore(input: { entityType: TrashEntityType; id: string; deletionOperationId: string }): Promise<void>
    permanentlyDelete(input: { entityType: TrashEntityType; id: string }): Promise<void>
    empty(): Promise<void>
  }
  search(input: { query: string }): Promise<SearchResult[]>
}
