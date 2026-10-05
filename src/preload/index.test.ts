import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  exposed: undefined as unknown,
  invocations: [] as Array<[string, unknown]>,
  listeners: new Map<string, (event: any) => void>(),
  ipcListeners: new Map<string, (...args: any[]) => void>(),
  sent: [] as Array<[string, unknown]>
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
      return Promise.resolve(undefined)
    }
  }
}))

describe('preload diagnostics bridge', () => {
  beforeEach(async () => {
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
