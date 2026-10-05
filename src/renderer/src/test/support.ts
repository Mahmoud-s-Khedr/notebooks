import { vi } from 'vitest'
import type {
  AppPreferences,
  Asset,
  Block,
  BlockRelation,
  BlockType,
  Job,
  Notebook,
  NotebookTree,
  Note,
  Page,
  PageWorkspace,
  ResearchNotebookApi,
  SourceDocument,
  TranscriptionRun,
  TrashRecord
} from '../../../shared/domain'

const now = '2026-10-04T12:00:00.000Z'
const deleted = { deletedAt: null, deletionOperationId: null }

export const notebook = (overrides: Partial<Notebook> = {}): Notebook => ({
  id: 'notebook-1',
  title: 'Research',
  createdAt: now,
  updatedAt: now,
  ...deleted,
  ...overrides
})
export const page = (overrides: Partial<Page> = {}): Page => ({
  id: 'page-1',
  notebookId: 'notebook-1',
  title: 'Topic page',
  position: 0,
  createdAt: now,
  updatedAt: now,
  ...deleted,
  ...overrides
})
export const note = (overrides: Partial<Note> = {}): Note => ({
  id: 'note-1',
  pageId: 'page-1',
  title: 'Untitled note',
  position: 0,
  createdAt: now,
  updatedAt: now,
  ...deleted,
  ...overrides
})
export const block = (overrides: Partial<Block> = {}): Block => ({
  id: 'block-1',
  noteId: 'note-1',
  type: 'text',
  position: 0,
  data: { text: 'A thought' },
  metadata: {},
  createdAt: now,
  updatedAt: now,
  ...deleted,
  ...overrides
})
export const workspace = (overrides: Partial<PageWorkspace> = {}): PageWorkspace => ({
  ...page(),
  notes: [],
  nextCursor: null,
  ...overrides
})
export const notebookTree = (overrides: Partial<NotebookTree> = {}): NotebookTree => ({
  ...notebook(),
  pages: [page()],
  ...overrides
})
export const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'asset-1',
  notebookId: 'notebook-1',
  kind: 'image',
  relativePath: 'assets/image.png',
  originalFilename: 'image.png',
  mimeType: 'image/png',
  byteSize: 10,
  sha256: 'hash',
  metadata: {},
  createdAt: now,
  updatedAt: now,
  ...overrides
})
export const source = (overrides: Partial<SourceDocument> = {}): SourceDocument => ({
  id: 'source-1',
  notebookId: 'notebook-1',
  title: 'Fixture source',
  sourceType: 'pdf',
  relativePath: 'sources/fixture.pdf',
  assetId: 'asset-1',
  metadata: {},
  createdAt: now,
  updatedAt: now,
  ...overrides
})
export const relation = (overrides: Partial<BlockRelation> = {}): BlockRelation => ({
  id: 'relation-1',
  fromBlockId: 'block-1',
  toBlockId: 'block-2',
  relationType: 'explains',
  metadata: {},
  createdAt: now,
  ...overrides
})
export const preferences = (overrides: Partial<AppPreferences> = {}): AppPreferences => ({
  theme: 'system',
  density: 'default',
  ...overrides
})
export const testError = (message = 'The requested change could not be saved.'): Error => new Error(message)

type MockGroup<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? ReturnType<typeof vi.fn> : T[K]
}
export type ResearchNotebookApiMock = {
  [K in keyof ResearchNotebookApi]: ResearchNotebookApi[K] extends (...args: never[]) => unknown
    ? ReturnType<typeof vi.fn>
    : MockGroup<ResearchNotebookApi[K]>
}

const job = (): Job => ({
  id: 'job-1',
  kind: 'export',
  transcriptionRunId: null,
  status: 'completed',
  progress: 100,
  errorMessage: null,
  result: null,
  attempts: 1,
  createdAt: now,
  startedAt: now,
  completedAt: now
})
const trashRecord = (): TrashRecord => ({
  entityType: 'block',
  id: 'block-1',
  title: 'A thought',
  deletedAt: now,
  deletionOperationId: 'delete-1'
})
const transcriptionRun = (): TranscriptionRun => ({
  id: 'run-1',
  assetId: 'asset-1',
  blockId: 'block-1',
  provider: 'local',
  model: 'fixture-model',
  language: null,
  durationMs: null,
  status: 'completed',
  confidence: null,
  transcriptText: null,
  errorMessage: null,
  startedAt: now,
  completedAt: now,
  createdAt: now,
  updatedAt: now,
  segments: []
})

/** A complete preload API mock. Defaults are deliberately harmless async values. */
export const createResearchNotebookApi = (): ResearchNotebookApiMock => {
  const api = {
    notebooks: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(notebook()),
      update: vi.fn().mockResolvedValue(notebook())
    },
    pages: {
      create: vi.fn().mockResolvedValue(page()),
      update: vi.fn().mockResolvedValue(page()),
      getWorkspace: vi.fn().mockResolvedValue(workspace())
    },
    notes: {
      create: vi.fn().mockResolvedValue(note()),
      update: vi.fn().mockResolvedValue(note()),
      duplicate: vi.fn().mockResolvedValue(note())
    },
    blocks: {
      create: vi
        .fn()
        .mockImplementation(async ({ noteId, type }: { noteId: string; type: BlockType }) => block({ noteId, type })),
      update: vi.fn().mockResolvedValue(block()),
      updateType: vi.fn().mockResolvedValue(block()),
      duplicate: vi.fn().mockResolvedValue(block()),
      reorder: vi.fn().mockResolvedValue(undefined)
    },
    assets: {
      import: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
      dataUrl: vi.fn().mockResolvedValue(''),
      attach: vi.fn().mockResolvedValue(block()),
      diagnostics: vi.fn().mockResolvedValue({ missing: [], orphaned: [], untrackedFiles: [], hashMismatched: [] }),
      remove: vi.fn().mockResolvedValue(undefined),
      saveRecording: vi.fn().mockResolvedValue(block()),
      requestThumbnail: vi.fn().mockResolvedValue(job()),
      thumbnailDataUrl: vi.fn().mockResolvedValue(null)
    },
    transcription: {
      create: vi.fn().mockResolvedValue(job()),
      get: vi.fn().mockResolvedValue(transcriptionRun()),
      list: vi.fn().mockResolvedValue([]),
      retry: vi.fn().mockResolvedValue(job())
    },
    settings: {
      preferences: vi.fn().mockResolvedValue(preferences()),
      updatePreferences: vi.fn().mockResolvedValue(preferences()),
      transcription: vi.fn().mockResolvedValue({
        openRouterConfigured: false,
        localModels: [],
        openRouterModels: [],
        localBinaryAvailable: false,
        localModelAvailable: false,
        selectedLocalModel: null,
        localDownload: { state: 'idle', progress: null, error: null }
      }),
      setOpenRouterKey: vi.fn().mockResolvedValue(undefined),
      removeOpenRouterKey: vi.fn().mockResolvedValue(undefined),
      models: vi.fn().mockResolvedValue([]),
      downloadModel: vi.fn().mockResolvedValue(job()),
      cancelModelDownload: vi.fn().mockResolvedValue(undefined),
      removeModel: vi.fn().mockResolvedValue(undefined),
      setDefaultModel: vi.fn().mockResolvedValue(undefined),
      storage: vi.fn().mockResolvedValue({
        libraryPath: '/tmp/library',
        databaseBytes: 0,
        assetsBytes: 0,
        modelsBytes: 0,
        oldLibraryPath: null,
        migration: { state: 'idle', destination: null, error: null }
      }),
      moveLibrary: vi.fn().mockResolvedValue(null),
      migrationStatus: vi.fn().mockResolvedValue({ state: 'idle', destination: null, error: null }),
      removeOldLibrary: vi.fn().mockResolvedValue(undefined)
    },
    exports: { start: vi.fn().mockResolvedValue(job()) },
    jobs: {
      list: vi.fn().mockResolvedValue([]),
      cancel: vi.fn().mockResolvedValue(job()),
      retry: vi.fn().mockResolvedValue(job())
    },
    backups: { start: vi.fn().mockResolvedValue(job()) },
    diagnostics: {
      list: vi.fn().mockResolvedValue([]),
      listErrors: vi.fn().mockResolvedValue([]),
      getError: vi.fn().mockResolvedValue(null),
      reportError: vi.fn().mockResolvedValue(undefined),
      export: vi.fn().mockResolvedValue(null)
    },
    imports: { start: vi.fn().mockResolvedValue(null) },
    sources: {
      importPdf: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
      getBlockSource: vi.fn().mockResolvedValue(null),
      captureText: vi.fn().mockResolvedValue(block()),
      captureRegion: vi.fn().mockResolvedValue(block()),
      createQaNote: vi.fn().mockResolvedValue(note())
    },
    relations: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(relation()),
      remove: vi.fn().mockResolvedValue(undefined)
    },
    trash: {
      list: vi.fn().mockResolvedValue([]),
      move: vi.fn().mockResolvedValue(trashRecord()),
      restore: vi.fn().mockResolvedValue(undefined),
      permanentlyDelete: vi.fn().mockResolvedValue(undefined),
      empty: vi.fn().mockResolvedValue(undefined)
    },
    search: vi.fn().mockResolvedValue([])
  }
  return api as unknown as ResearchNotebookApiMock
}

export const installResearchNotebookApi = (api = createResearchNotebookApi()): ResearchNotebookApiMock => {
  Object.defineProperty(window, 'researchNotebook', { configurable: true, writable: true, value: api })
  return api
}
