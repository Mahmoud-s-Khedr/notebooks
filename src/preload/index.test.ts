import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  exposed: undefined as unknown,
  invocations: [] as Array<[string, unknown]>,
  listeners: new Map<string, (event: any) => void>(),
  ipcListeners: new Map<string, (...args: any[]) => void>(),
  sent: [] as Array<[string, unknown]>,
  invoke: vi.fn().mockResolvedValue({ ok: true })
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, value: unknown) => {
      state.exposed = value
    }
  },
  ipcRenderer: {
    on: (channel: string, handler: (...args: any[]) => void) => state.ipcListeners.set(channel, handler),
    removeListener: (channel: string) => state.ipcListeners.delete(channel),
    send: (channel: string, input?: unknown) => state.sent.push([channel, input]),
    invoke: (channel: string, input?: unknown) => {
      state.invocations.push([channel, input])
      return state.invoke(channel, input)
    }
  }
}))

describe('preload diagnostics bridge', () => {
  beforeEach(async () => {
    state.invoke.mockReset().mockResolvedValue({ ok: true })
    state.exposed = undefined
    state.invocations.length = 0
    state.listeners.clear()
    state.ipcListeners.clear()
    state.sent.length = 0
    vi.stubGlobal('window', {
      addEventListener: (type: string, handler: (event: any) => void) => state.listeners.set(type, handler)
    })
    await import('./index')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('exposes only the diagnostics methods and routes them through IPC', async () => {
    const api = state.exposed as {
      diagnostics: {
        listErrors: (input: unknown) => Promise<void>
        getError: (input: unknown) => Promise<void>
        reportError: (input: unknown) => Promise<void>
      }
    }
    await api.diagnostics.listErrors({ process: 'job' })
    await api.diagnostics.getError({ id: 'd18e3e67-31d4-4d4f-bbb7-e3b43d55c45d' })
    await api.diagnostics.reportError({ category: 'manual', message: 'A renderer error' })
    expect(state.invocations).toEqual([
      ['diagnostics:list-errors', { process: 'job' }],
      ['diagnostics:get-error', { id: 'd18e3e67-31d4-4d4f-bbb7-e3b43d55c45d' }],
      ['diagnostics:report-error', { category: 'manual', message: 'A renderer error' }]
    ])
  })

  it('forwards every invocation contract and propagates replies and failures', async () => {
    const contracts: Array<[string, string, boolean]> = [
      ['lifecycle.restart', 'lifecycle:restart', false],
      ['notebooks.list', 'notebooks:list', false],
      ['notebooks.create', 'notebooks:create', true],
      ['notebooks.update', 'notebooks:update', true],
      ['pages.create', 'pages:create', true],
      ['pages.update', 'pages:update', true],
      ['pages.getWorkspace', 'pages:get-workspace', true],
      ['notes.create', 'notes:create', true],
      ['notes.update', 'notes:update', true],
      ['notes.duplicate', 'notes:duplicate', true],
      ['blocks.create', 'blocks:create', true],
      ['blocks.update', 'blocks:update', true],
      ['blocks.updateType', 'blocks:update-type', true],
      ['blocks.duplicate', 'blocks:duplicate', true],
      ['blocks.reorder', 'blocks:reorder', true],
      ['assets.import', 'assets:import', true],
      ['assets.list', 'assets:list', true],
      ['assets.dataUrl', 'assets:data-url', true],
      ['assets.attach', 'assets:attach', true],
      ['assets.diagnostics', 'assets:diagnostics', true],
      ['assets.remove', 'assets:remove', true],
      ['assets.saveRecording', 'assets:save-recording', true],
      ['assets.requestThumbnail', 'assets:request-thumbnail', true],
      ['assets.thumbnailDataUrl', 'assets:thumbnail-data-url', true],
      ['transcription.review', 'transcription:review', true],
      ['transcription.create', 'transcription:create', true],
      ['transcription.get', 'transcription:get', true],
      ['transcription.list', 'transcription:list', true],
      ['transcription.retry', 'transcription:retry', true],
      ['settings.preferences', 'settings:preferences', false],
      ['settings.updatePreferences', 'settings:preferences:update', true],
      ['settings.transcription', 'settings:transcription', false],
      ['settings.setOpenRouterKey', 'settings:openrouter-key', true],
      ['settings.removeOpenRouterKey', 'settings:openrouter-key:remove', false],
      ['settings.models', 'settings:models', false],
      ['settings.downloadModel', 'settings:models:download', true],
      ['settings.cancelModelDownload', 'settings:models:cancel', true],
      ['settings.removeModel', 'settings:models:remove', true],
      ['settings.setDefaultModel', 'settings:models:default', true],
      ['settings.storage', 'settings:storage', true],
      ['settings.moveLibrary', 'settings:migration:start', false],
      ['settings.migrationStatus', 'settings:migration:status', false],
      ['settings.removeOldLibrary', 'settings:migration:remove-old', false],
      ['exports.start', 'exports:start', true],
      ['exports.openFolder', 'exports:open-folder', true],
      ['jobs.get', 'jobs:get', true],
      ['jobs.list', 'jobs:list', false],
      ['jobs.cancel', 'jobs:cancel', true],
      ['jobs.retry', 'jobs:retry', true],
      ['diagnostics.cleanup', 'diagnostics:cleanup', true],
      ['diagnostics.list', 'diagnostics:list', false],
      ['diagnostics.listErrors', 'diagnostics:list-errors', true],
      ['diagnostics.getError', 'diagnostics:get-error', true],
      ['diagnostics.reportError', 'diagnostics:report-error', true],
      ['diagnostics.export', 'diagnostics:export', false],
      ['sources.importPdf', 'sources:import-pdf', true],
      ['sources.list', 'sources:list', true],
      ['sources.getBlockSource', 'sources:get-block-source', true],
      ['sources.captureText', 'sources:capture-text', true],
      ['sources.captureRegion', 'sources:capture-region', true],
      ['sources.createQaNote', 'sources:create-qa-note', true],
      ['relations.list', 'relations:list', true],
      ['relations.create', 'relations:create', true],
      ['relations.remove', 'relations:remove', true],
      ['trash.list', 'trash:list', false],
      ['trash.move', 'trash:move', true],
      ['trash.restore', 'trash:restore', true],
      ['trash.permanentlyDelete', 'trash:permanently-delete', true],
      ['trash.empty', 'trash:empty', false],
      ['backups.start', 'backups:start', false],
      ['imports.start', 'imports:start', false],
      ['search', 'search', true]
    ]
    const api = state.exposed as Record<string, unknown>
    for (const [path, channel, acceptsInput] of contracts) {
      const [group, method] = path.split('.')
      const call = (method ? (api[group] as Record<string, unknown>)[method] : api[group]) as (
        input?: unknown
      ) => Promise<unknown>
      const payload = acceptsInput ? { id: 'item', optional: undefined } : undefined
      await expect(call(payload)).resolves.toEqual({ ok: true })
      expect(state.invocations.at(-1)).toEqual([channel, payload])
      const failure = new Error(`Failed ${channel}`)
      state.invoke.mockRejectedValueOnce(failure)
      await expect(call(payload)).rejects.toBe(failure)
    }
    expect(contracts).toHaveLength(72)
  })

  it('uses diagnostic fallbacks and swallows reporting failures', async () => {
    state.invoke.mockRejectedValue(new Error('IPC unavailable'))
    state.listeners.get('error')?.({ message: '', error: 'not an Error' })
    for (const reason of ['rejected string', null, { reason: 'object' }])
      state.listeners.get('unhandledrejection')?.({ reason })
    await Promise.resolve()
    expect(state.invocations.map(([, value]) => value)).toEqual([
      expect.objectContaining({ message: 'Unhandled renderer error', stack: undefined }),
      expect.objectContaining({ message: 'rejected string', stack: undefined }),
      expect.objectContaining({ message: 'Unhandled promise rejection', stack: undefined }),
      expect.objectContaining({ message: '[object Object]', stack: undefined })
    ])
  })

  it('reports browser errors and unhandled promise rejections without throwing', async () => {
    state.listeners.get('error')?.({
      message: 'Render exploded',
      error: new Error('Render exploded'),
      filename: '/tmp/App.tsx',
      lineno: 14,
      colno: 3
    })
    state.listeners.get('unhandledrejection')?.({ reason: new Error('Save rejected') })
    await Promise.resolve()
    expect(state.invocations).toEqual(
      expect.arrayContaining([
        [
          'diagnostics:report-error',
          expect.objectContaining({
            category: 'window.error',
            message: 'Render exploded',
            context: { filename: '/tmp/App.tsx', line: 14, column: 3 }
          })
        ],
        [
          'diagnostics:report-error',
          expect.objectContaining({
            category: 'window.unhandledrejection',
            message: 'Save rejected',
            stack: expect.stringContaining('Save rejected')
          })
        ]
      ])
    )
  })
  it('signals readiness after subscribing, correlates close replies and removes its listener', async () => {
    const api = state.exposed as import('../shared/domain').ResearchNotebookApi
    const handler = vi.fn().mockResolvedValue(undefined)
    const dispose = api.lifecycle.onCloseRequest(handler)
    expect(state.sent).toContainEqual(['lifecycle:ready', undefined])
    state.ipcListeners.get('lifecycle:save-before-close')?.({}, 'request-id')
    expect(handler).toHaveBeenCalledWith('request-id')
    api.lifecycle.closeResult({ requestId: 'request-id', saved: false })
    expect(state.sent).toContainEqual(['lifecycle:close-result', { requestId: 'request-id', saved: false }])
    await api.lifecycle.restart()
    expect(state.invocations).toContainEqual(['lifecycle:restart', undefined])
    dispose()
    expect(state.ipcListeners.has('lifecycle:save-before-close')).toBe(false)
  })
})
