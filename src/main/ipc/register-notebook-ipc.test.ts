import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dialog } from 'electron'
import { NotebookDatabase } from '../database/database'
import { ErrorLogService } from '../services/error-log-service'
import { NotebookService } from '../services/notebook-service'

const frame = {}
const sender = { mainFrame: frame }

const state = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>() }))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
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
