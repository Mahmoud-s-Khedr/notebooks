import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dialog, shell } from 'electron'
import { NotebookDatabase } from '../database/database'
import { ErrorLogService } from '../services/error-log-service'
import { NotebookService } from '../services/notebook-service'

const frame = {}
const sender = { mainFrame: frame }

const state = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>() }))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) =>
      state.handlers.set(channel, handler)
  }
}))

import { notebookIpcEndpoints, registerNotebookIpc } from './register-notebook-ipc'

describe('registered notebook IPC diagnostics', () => {
  let database: NotebookDatabase
  let service: NotebookService
  let errors: ErrorLogService

  beforeEach(() => {
    state.handlers.clear()
    vi.mocked(dialog.showOpenDialog).mockReset()
    database = new NotebookDatabase(':memory:')
    errors = new ErrorLogService(database.connection, '/tmp/unused-ipc-errors.ndjson', 'test', true)
    service = new NotebookService(database, undefined, undefined, undefined, undefined, errors)
    registerNotebookIpc(service, errors, (event) => event.sender === sender)
  })
  afterEach(() => database.close())

  const invoke = (channel: string, input: unknown) =>
    state.handlers.get(channel)?.({ sender, senderFrame: frame }, input) ??
    Promise.reject(new Error(`Missing ${channel} handler`))

  it('registers every endpoint in the inventory', () => {
    const endpoints = notebookIpcEndpoints(service)
    expect(state.handlers.size).toBe(endpoints.length)
    expect([...state.handlers.keys()]).toEqual(endpoints.map((endpoint) => endpoint.channel))
    expect(endpoints).toHaveLength(71)
  })

  it.each(['null', 'malformed', 'unknown field'] as const)(
    'rejects %s input for every endpoint without recording submitted data',
    async (kind) => {
      const unsafeValue = 'do-not-log-this-submitted-value'
      const input = kind === 'null' ? null : kind === 'malformed' ? [] : { unexpected: unsafeValue }

      for (const { channel } of notebookIpcEndpoints(service)) {
        await expect(invoke(channel, input)).rejects.toThrow()
        const event = errors.list({ category: channel })[0]
        expect(event).toMatchObject({
          process: 'main',
          layer: 'ipc',
          category: channel,
          code: 'IPC_VALIDATION_FAILED',
          context: { channel }
        })
        expect(JSON.stringify(event)).not.toContain(unsafeValue)
      }
    }
  )

  it('dispatches representative CRUD, ordering, relation, job, settings, source, and diagnostic calls', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const otherId = '22222222-2222-4222-8222-222222222222'
    const createNotebook = vi.spyOn(service, 'createNotebook').mockResolvedValue({ id } as never)
    const reorderBlocks = vi.spyOn(service, 'reorderBlocks').mockResolvedValue(undefined)
    const createRelation = vi.spyOn(service, 'createRelation').mockResolvedValue({ id } as never)
    const moveToTrash = vi.spyOn(service, 'moveToTrash').mockResolvedValue({ id } as never)
    const createTranscription = vi.spyOn(service, 'createTranscription').mockResolvedValue({ id } as never)
    const downloadModel = vi.spyOn(service, 'downloadWhisperModel').mockResolvedValue({ id } as never)
    const cancelJob = vi.spyOn(service, 'cancelJob').mockResolvedValue({ id } as never)
    const captureText = vi.spyOn(service, 'captureSourceText').mockResolvedValue({ id } as never)
    const getError = vi.spyOn(service, 'getError').mockReturnValue({ id } as never)

    await expect(invoke('notebooks:create', { title: ' Notebook ' })).resolves.toEqual({ id })
    await expect(invoke('blocks:reorder', { noteId: id, blockIds: [otherId] })).resolves.toBeUndefined()
    await expect(
      invoke('relations:create', { fromBlockId: id, toBlockId: otherId, relationType: 'explains' })
    ).resolves.toEqual({ id })
    await expect(invoke('trash:move', { entityType: 'note', id })).resolves.toEqual({ id })
    await expect(
      invoke('transcription:create', { blockId: id, provider: 'local', model: 'base', language: ' en ' })
    ).resolves.toEqual({ id })
    await expect(invoke('settings:models:download', { modelId: 'base' })).resolves.toEqual({ id })
    await expect(invoke('jobs:cancel', { jobId: id })).resolves.toEqual({ id })
    await expect(
      invoke('sources:capture-text', {
        noteId: id,
        sourceDocumentId: otherId,
        pdfPage: 3,
        printedPage: 7,
        text: 'Selected source text'
      })
    ).resolves.toEqual({ id })
    await expect(invoke('diagnostics:get-error', { id })).resolves.toEqual({ id })

    expect(createNotebook).toHaveBeenCalledWith('Notebook')
    expect(reorderBlocks).toHaveBeenCalledWith(id, [otherId])
    expect(createRelation).toHaveBeenCalledWith(id, otherId, 'explains')
    expect(moveToTrash).toHaveBeenCalledWith('note', id)
    expect(createTranscription).toHaveBeenCalledWith(id, 'local', 'base', 'en')
    expect(downloadModel).toHaveBeenCalledWith('base')
    expect(cancelJob).toHaveBeenCalledWith(id)
    expect(captureText).toHaveBeenCalledWith(id, otherId, 3, 7, 'Selected source text')
    expect(getError).toHaveBeenCalledWith(id)
  })

  it('keeps every dialog endpoint cancellation behavior explicit', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const dialogInputs: Record<string, unknown> = {
      'assets:import': { notebookId: id, kind: 'file' },
      'settings:migration:start': undefined,
      'exports:start': { scope: { type: 'notebook', notebookId: id }, format: 'markdown' },
      'backups:start': undefined,
      'diagnostics:export': undefined,
      'imports:start': undefined,
      'sources:import-pdf': { notebookId: id }
    }
    const dialogEndpoints = notebookIpcEndpoints(service).filter((endpoint) => endpoint.dialog)

    expect(dialogEndpoints.map((endpoint) => endpoint.channel)).toEqual(Object.keys(dialogInputs))
    for (const endpoint of dialogEndpoints) {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
      const result = invoke(endpoint.channel, dialogInputs[endpoint.channel])
      if (endpoint.dialog?.cancellation === 'throw') await expect(result).rejects.toThrow('cancelled')
      else await expect(result).resolves.toBeNull()
    }
  })

  it('dispatches selected dialog paths to the matching service operation', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const importAsset = vi.spyOn(service, 'importAsset').mockResolvedValue({ id } as never)
    const moveLibrary = vi.spyOn(service, 'startLibraryMove').mockResolvedValue({ id } as never)
    const startExport = vi.spyOn(service, 'startExport').mockResolvedValue({ id } as never)
    const startBackup = vi.spyOn(service, 'startBackup').mockResolvedValue({ id } as never)
    const exportDiagnostics = vi.spyOn(service, 'exportDiagnostics').mockReturnValue('/tmp/diagnostics.txt')
    const importLossless = vi.spyOn(service, 'importLossless').mockResolvedValue({ importedAssets: 0 } as never)
    const importPdf = vi.spyOn(service, 'importPdf').mockResolvedValue({ id } as never)
    const selectedPath = '/tmp/selected-path'
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [selectedPath] })

    await invoke('assets:import', { notebookId: id, kind: 'file' })
    await invoke('settings:migration:start', undefined)
    await invoke('exports:start', { scope: { type: 'notebook', notebookId: id }, format: 'markdown' })
    await invoke('backups:start', undefined)
    await invoke('diagnostics:export', undefined)
    await invoke('imports:start', undefined)
    await invoke('sources:import-pdf', { notebookId: id })

    expect(importAsset).toHaveBeenCalledWith(id, 'file', selectedPath)
    expect(moveLibrary).toHaveBeenCalledWith(selectedPath)
    expect(startExport).toHaveBeenCalledWith({ type: 'notebook', notebookId: id }, 'markdown', selectedPath)
    expect(startBackup).toHaveBeenCalledWith(selectedPath)
    expect(exportDiagnostics).toHaveBeenCalledWith(selectedPath)
    expect(importLossless).toHaveBeenCalledWith(selectedPath)
    expect(importPdf).toHaveBeenCalledWith(id, selectedPath)
  })

  it('opens only a service-resolved export folder and propagates shell failures', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const directory = vi.spyOn(service, 'exportDirectory').mockReturnValue('/tmp/verified-export')
    vi.mocked(shell.openPath).mockResolvedValueOnce('')
    await expect(invoke('exports:open-folder', { jobId: id })).resolves.toBeUndefined()
    expect(directory).toHaveBeenCalledWith(id)
    expect(shell.openPath).toHaveBeenCalledWith('/tmp/verified-export')
    vi.mocked(shell.openPath).mockResolvedValueOnce('Permission denied')
    await expect(invoke('exports:open-folder', { jobId: id })).rejects.toThrow('could not be opened')
  })

  it('treats empty dialog selections as cancellation and propagates dialog errors', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    for (const [channel, input] of [
      ['assets:import', { notebookId: id, kind: 'image' }],
      ['settings:migration:start', undefined],
      ['exports:start', { scope: { type: 'note', noteId: id }, format: 'pdf' }],
      ['backups:start', undefined],
      ['diagnostics:export', undefined],
      ['imports:start', undefined],
      ['sources:import-pdf', { notebookId: id }]
    ] as const) {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [] })
      await expect(invoke(channel, input)).resolves.toBeNull()
      vi.mocked(dialog.showOpenDialog).mockRejectedValueOnce(new Error('Dialog unavailable'))
      await expect(invoke(channel, input)).rejects.toThrow('Dialog unavailable')
    }
  })

  it('accepts bounded diagnostic values and rejects oversized arrays, strings and objects', async () => {
    const report = vi.spyOn(service, 'reportRendererError').mockReturnValue(undefined)
    const context = { values: [null, true, 42, 'detail', { nested: false }] }
    await expect(
      invoke('diagnostics:report-error', { category: 'manual', message: 'detail', context })
    ).resolves.toBeUndefined()
    expect(report).toHaveBeenCalledWith({ category: 'manual', message: 'detail', context })
    for (const context of [
      { items: Array(101).fill(1) },
      { text: 'x'.repeat(20001) },
      Object.fromEntries(Array.from({ length: 101 }, (_, i) => [String(i), true])),
      { invalid: undefined }
    ])
      await expect(
        invoke('diagnostics:report-error', { category: 'manual', message: 'detail', context })
      ).rejects.toThrow('safe limits')
  })

  it('records validation failures and rethrows the original rejection', async () => {
    await expect(invoke('notebooks:create', { title: '' })).rejects.toThrow('A title is required')
    const event = errors.list({ category: 'notebooks:create' })[0]
    expect(event).toMatchObject({
      process: 'main',
      layer: 'ipc',
      code: 'IPC_VALIDATION_FAILED',
      category: 'notebooks:create'
    })
    expect(event.ipcId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('records service handler failures with the channel correlation ID', async () => {
    await expect(invoke('pages:get-workspace', { pageId: crypto.randomUUID() })).rejects.toThrow('does not exist')
    const event = errors.list({ category: 'pages:get-workspace' })[0]
    expect(event).toMatchObject({ code: 'IPC_HANDLER_FAILED', process: 'main', layer: 'ipc' })
    expect(event.stack).toContain('does not exist')
    expect(event.ipcId).toBeTruthy()
  })

  it('accepts bounded renderer reports and rejects unsafe renderer metadata', async () => {
    await expect(
      invoke('diagnostics:report-error', {
        category: 'window.error',
        message: 'Renderer failed',
        stack: 'Error: Renderer failed',
        context: { filename: '/tmp/view.tsx' },
        operationId: 'render-7'
      })
    ).resolves.toBeUndefined()
    expect(errors.list({ process: 'renderer' })[0]).toMatchObject({
      category: 'window.error',
      operationId: 'render-7',
      context: { filename: '/tmp/view.tsx' }
    })
    await expect(
      invoke('diagnostics:report-error', {
        category: 'window.error',
        message: 'too deep',
        context: { a: { b: { c: { d: { e: { f: { g: true } } } } } } }
      })
    ).rejects.toThrow('safe limits')
    expect(errors.list({ category: 'diagnostics:report-error' })[0].code).toBe('IPC_HANDLER_FAILED')
  })
})

it('rejects foreign senders and subframes before payload handling', async () => {
  const database = new NotebookDatabase(':memory:')
  try {
    const errors = new ErrorLogService(database.connection, '/tmp/unused-ipc-errors.ndjson', 'test', true)
    const service = new NotebookService(database)
    registerNotebookIpc(service, errors, (event) => event.sender === sender)
    const create = vi.spyOn(service, 'createNotebook')
    const handler = state.handlers.get('notebooks:create')!
    await expect(handler({ sender: { mainFrame: frame }, senderFrame: frame }, { title: 'Foreign' })).rejects.toThrow(
      'Untrusted'
    )
    await expect(handler({ sender, senderFrame: {} }, { title: 'Subframe' })).rejects.toThrow('Untrusted')
    expect(create).not.toHaveBeenCalled()
  } finally {
    database.close()
  }
})

describe('valid endpoint dispatch contracts', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const other = '22222222-2222-4222-8222-222222222222'
  const contracts: Array<[string, keyof NotebookService, unknown, unknown[]]> = [
    ['notebooks:list', 'listNotebooks', undefined, []],
    ['notebooks:update', 'updateNotebook', { notebookId: id, title: ' Title ' }, [id, 'Title']],
    ['pages:create', 'createPage', { notebookId: id, title: 'Title' }, [id, 'Title']],
    ['pages:update', 'updatePage', { pageId: id, title: 'Title' }, [id, 'Title']],
    ['pages:get-workspace', 'getPageWorkspace', { pageId: id, cursor: '42' }, [id, '42']],
    ['notes:create', 'createNote', { pageId: id, title: 'Title' }, [id, 'Title']],
    ['notes:update', 'updateNote', { noteId: id, title: 'Title' }, [id, 'Title']],
    ['notes:duplicate', 'duplicateNote', { noteId: id }, [id]],
    [
      'blocks:create',
      'createBlock',
      { noteId: id, type: 'text', data: { text: 'hello' } },
      [id, 'text', { text: 'hello' }]
    ],
    ['blocks:update', 'updateBlock', { blockId: id, data: { text: 'hello' } }, [id, { text: 'hello' }]],
    ['blocks:update-type', 'updateBlockType', { blockId: id, type: 'explanation' }, [id, 'explanation']],
    ['blocks:duplicate', 'duplicateBlock', { blockId: id }, [id]],
    ['relations:list', 'listRelations', { blockId: id }, [id]],
    ['relations:remove', 'removeRelation', { relationId: id }, [id]],
    ['trash:list', 'listTrash', undefined, []],
    [
      'trash:restore',
      'restoreFromTrash',
      { entityType: 'block', id, deletionOperationId: other },
      ['block', id, other]
    ],
    ['trash:permanently-delete', 'permanentlyDelete', { entityType: 'page', id }, ['page', id]],
    ['trash:empty', 'emptyTrash', undefined, []],
    ['search', 'search', { query: ' hello ' }, ['hello']],
    ['assets:list', 'listAssets', { notebookId: id }, [id]],
    ['assets:data-url', 'assetDataUrl', { assetId: id }, [id]],
    ['assets:attach', 'attachAsset', { noteId: id, assetId: other, type: 'audio' }, [id, other, 'audio']],
    ['assets:diagnostics', 'diagnoseAssets', { notebookId: id }, [id]],
    ['assets:remove', 'removeAsset', { assetId: id }, [id]],
    [
      'assets:save-recording',
      'saveRecording',
      { noteId: id, wavBase64: 'a'.repeat(60), filename: 'recording.wav', operationId: other },
      [id, 'a'.repeat(60), 'recording.wav', other]
    ],
    ['assets:request-thumbnail', 'requestThumbnail', { assetId: id, width: 32, height: 2048 }, [id, 32, 2048]],
    ['assets:thumbnail-data-url', 'thumbnailDataUrl', { assetId: id, width: 32, height: 32 }, [id, 32, 32]],
    ['transcription:get', 'getTranscription', { runId: id }, [id]],
    ['transcription:list', 'listTranscriptions', { blockId: id }, [id]],
    ['transcription:retry', 'retryTranscription', { runId: id }, [id]],
    ['transcription:review', 'reviewTranscript', { runId: id, text: 'reviewed' }, [id, 'reviewed']],
    ['settings:transcription', 'transcriptionSettings', undefined, []],
    ['settings:openrouter-key', 'setOpenRouterKey', { key: 'test-key' }, ['test-key']],
    ['settings:openrouter-key:remove', 'removeOpenRouterKey', undefined, []],
    ['settings:preferences', 'preferences', undefined, []],
    [
      'settings:preferences:update',
      'updatePreferences',
      { theme: 'dark', density: 'compact' },
      [{ theme: 'dark', density: 'compact' }]
    ],
    ['settings:models', 'listWhisperModels', undefined, []],
    ['settings:models:cancel', 'cancelWhisperModelDownload', { modelId: 'base' }, ['base']],
    ['settings:models:remove', 'removeWhisperModel', { modelId: 'base' }, ['base']],
    ['settings:models:default', 'setDefaultWhisperModel', { modelId: 'base' }, ['base']],
    ['settings:storage', 'storageSummary', { refresh: true }, [true]],
    ['settings:migration:status', 'migrationStatus', undefined, []],
    ['settings:migration:remove-old', 'removeOldLibrary', undefined, []],
    ['jobs:get', 'getJob', { jobId: id }, [id]],
    ['jobs:list', 'listJobs', undefined, []],
    ['jobs:retry', 'retryJob', { jobId: id }, [id]],
    ['diagnostics:list', 'diagnostics', undefined, []],
    [
      'diagnostics:list-errors',
      'listErrors',
      { severity: 'fatal', category: ' save ', process: 'main', limit: 10 },
      [{ severity: 'fatal', category: 'save', process: 'main', limit: 10 }]
    ],
    ['diagnostics:cleanup', 'historyCleanup', { kind: 'jobs', days: 7, apply: true }, ['jobs', 7, true]],
    ['sources:list', 'listSources', { notebookId: id }, [id]],
    ['sources:get-block-source', 'getBlockSource', { blockId: id }, [id]],
    [
      'sources:capture-region',
      'captureSourceRegion',
      {
        noteId: id,
        sourceDocumentId: other,
        pdfPage: 2,
        bounds: { x: 0, y: 0, width: 10, height: 20 },
        imageDataUrl: 'data:image/png;base64,abc',
        printedPage: 3
      },
      [id, other, 2, { x: 0, y: 0, width: 10, height: 20 }, 'data:image/png;base64,abc', 3]
    ],
    [
      'sources:create-qa-note',
      'createQaNote',
      { pageId: id, sourceDocumentId: other, pdfPage: 2, text: 'Question' },
      [id, other, 2, undefined, 'Question']
    ]
  ]
  it.each(contracts)(
    'dispatches %s with validated service arguments and preserves failures',
    async (channel, method, input, args) => {
      const db = new NotebookDatabase(':memory:')
      try {
        const errors = new ErrorLogService(db.connection, '/tmp/unused-ipc-errors.ndjson', 'test', true)
        const service = new NotebookService(db)
        const operation = vi.spyOn(service, method as any).mockReturnValue({ ok: channel })
        registerNotebookIpc(service, errors, () => true)
        const handler = state.handlers.get(channel)!
        await expect(handler({ sender, senderFrame: frame }, input)).resolves.toEqual({ ok: channel })
        expect(operation).toHaveBeenCalledWith(...args)
        const failure = new Error('service unavailable')
        operation.mockImplementationOnce(() => {
          throw failure
        })
        await expect(handler({ sender, senderFrame: frame }, input)).rejects.toBe(failure)
        expect(errors.list({ category: channel })[0].code).toBe('IPC_HANDLER_FAILED')
      } finally {
        db.close()
      }
    }
  )
  it('passes missing optional settings, language and diagnostic filters through', async () => {
    const db = new NotebookDatabase(':memory:')
    try {
      const service = new NotebookService(db)
      const errors = new ErrorLogService(db.connection, '/tmp/unused-ipc-errors.ndjson', 'test', true)
      const storage = vi.spyOn(service, 'storageSummary').mockReturnValue({} as never)
      const transcription = vi.spyOn(service, 'createTranscription').mockReturnValue({} as never)
      const filters = vi.spyOn(service, 'listErrors').mockReturnValue([])
      registerNotebookIpc(service, errors, () => true)
      await state.handlers.get('settings:storage')!({ sender, senderFrame: frame }, undefined)
      await state.handlers.get('transcription:create')!(
        { sender, senderFrame: frame },
        { blockId: id, provider: 'local', language: ' ' }
      )
      await state.handlers.get('diagnostics:list-errors')!({ sender, senderFrame: frame }, undefined)
      expect(storage).toHaveBeenCalledWith(undefined)
      expect(transcription).toHaveBeenCalledWith(id, 'local', undefined, undefined)
      expect(filters).toHaveBeenCalledWith(undefined)
    } finally {
      db.close()
    }
  })
})
