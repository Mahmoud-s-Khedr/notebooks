import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotebookDatabase } from '../database/database'
import { ErrorLogService } from '../services/error-log-service'
import { NotebookService } from '../services/notebook-service'

const state = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>() }))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => state.handlers.set(channel, handler) }
}))

import { registerNotebookIpc } from './register-notebook-ipc'

describe('registered notebook IPC diagnostics', () => {
  let database: NotebookDatabase
  let service: NotebookService
  let errors: ErrorLogService

  beforeEach(() => {
    state.handlers.clear()
    database = new NotebookDatabase(':memory:')
    errors = new ErrorLogService(database.connection, '/tmp/unused-ipc-errors.ndjson', 'test', true)
    service = new NotebookService(database, undefined, undefined, undefined, undefined, errors)
    registerNotebookIpc(service, errors)
  })
  afterEach(() => database.close())

  const invoke = (channel: string, input: unknown) => state.handlers.get(channel)?.({}, input) ?? Promise.reject(new Error(`Missing ${channel} handler`))

  it('records validation failures and rethrows the original rejection', async () => {
    await expect(invoke('notebooks:create', { title: '' })).rejects.toThrow('A title is required')
    const event = errors.list({ category: 'notebooks:create' })[0]
    expect(event).toMatchObject({ process: 'main', layer: 'ipc', code: 'IPC_VALIDATION_FAILED', category: 'notebooks:create' })
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
    await expect(invoke('diagnostics:report-error', { category: 'window.error', message: 'Renderer failed', stack: 'Error: Renderer failed', context: { filename: '/tmp/view.tsx' }, operationId: 'render-7' })).resolves.toBeUndefined()
    expect(errors.list({ process: 'renderer' })[0]).toMatchObject({ category: 'window.error', operationId: 'render-7', context: { filename: '/tmp/view.tsx' } })
    await expect(invoke('diagnostics:report-error', { category: 'window.error', message: 'too deep', context: { a: { b: { c: { d: { e: { f: { g: true } } } } } } } })).rejects.toThrow('safe limits')
    expect(errors.list({ category: 'diagnostics:report-error' })[0].code).toBe('IPC_HANDLER_FAILED')
  })
})
