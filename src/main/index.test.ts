import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  appEvents: new Map<string, (...args: any[]) => any>(),
  ipcEvents: new Map<string, (...args: any[]) => any>(),
  handlers: new Map<string, (...args: any[]) => any>(),
  windowEvents: new Map<string, (...args: any[]) => any>(),
  webEvents: new Map<string, (...args: any[]) => any>(),
  windows: [] as any[],
  options: [] as any[],
  ready: vi.fn(),
  quit: vi.fn(),
  relaunch: vi.fn(),
  message: vi.fn(),
  send: vi.fn(),
  reload: vi.fn(),
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  popup: vi.fn(),
  destroyed: vi.fn(),
  dbClose: vi.fn(),
  resume: vi.fn(),
  finish: vi.fn(),
  migration: vi.fn(),
  record: vi.fn(),
  fallback: vi.fn(),
  bootstrap: vi.fn(),
  database: vi.fn(),
  register: vi.fn(),
  service: vi.fn(),
  dev: true
}))
vi.mock('electron', () => ({
  app: {
    whenReady: state.ready,
    getPath: () => '/tmp/lifecycle-test',
    getVersion: () => 'test',
    on: (event: string, handler: (...args: any[]) => any) => state.appEvents.set(event, handler),
    quit: state.quit,
    relaunch: state.relaunch
  },
  dialog: { showMessageBox: state.message },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  },
  ipcMain: {
    on: (event: string, handler: (...args: any[]) => any) => state.ipcEvents.set(event, handler),
    handle: (event: string, handler: (...args: any[]) => any) => state.handlers.set(event, handler)
  },
  BrowserWindow: Object.assign(
    vi.fn(function (options) {
      state.options.push(options)
      const webContents = {
        mainFrame: {},
        send: state.send,
        setWindowOpenHandler: state.popup,
        on: (event: string, handler: (...args: any[]) => any) => state.webEvents.set(event, handler)
      }
      const window = {
        webContents,
        on: (event: string, handler: (...args: any[]) => any) => state.windowEvents.set(event, handler),
        close: vi.fn(() => state.windowEvents.get('close')?.({ preventDefault: vi.fn() })),
        reload: state.reload,
        loadURL: state.loadURL,
        loadFile: state.loadFile,
        isDestroyed: state.destroyed
      }
      state.windows.push(window)
      return window
    }),
    { getAllWindows: () => state.windows }
  )
}))
vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return state.dev
    }
  }
}))
vi.mock('./database/database', () => ({
  NotebookDatabase: vi.fn(function (...args) {
    state.database(...args)
    return { connection: {}, close: state.dbClose }
  })
}))
vi.mock('./services/error-log-service', () => ({
  ErrorLogService: vi.fn(function () {
    return { record: state.record }
  }),
  appendFallbackError: state.fallback
}))
vi.mock('./library-bootstrap', () => ({ resolveLibraryBootstrap: state.bootstrap }))
vi.mock('./ipc/register-notebook-ipc', () => ({ registerNotebookIpc: state.register }))
vi.mock('./services/notebook-service', () => ({
  NotebookService: vi.fn(function (...args) {
    state.service(...args)
    return { resumeJobs: state.resume, finishPendingWrites: state.finish, migrationStatus: state.migration }
  })
}))
let exceptions: NodeJS.UncaughtExceptionListener[]
let rejections: NodeJS.UnhandledRejectionListener[]
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  for (const map of [state.appEvents, state.ipcEvents, state.handlers, state.windowEvents, state.webEvents]) map.clear()
  state.windows.length = 0
  state.options.length = 0
  state.dev = true
  state.ready.mockResolvedValue(undefined)
  state.bootstrap.mockReturnValue({ activeRoot: '/tmp/active' })
  state.database.mockImplementation(() => undefined)
  state.finish.mockResolvedValue(undefined)
  state.migration.mockReturnValue({ state: 'pending-restart' })
  state.message.mockResolvedValue({ response: 3 })
  state.destroyed.mockReturnValue(false)
  exceptions = process.listeners('uncaughtException')
  rejections = process.listeners('unhandledRejection')
})
afterEach(() => {
  for (const listener of process.listeners('uncaughtException'))
    if (!exceptions.includes(listener)) process.removeListener('uncaughtException', listener)
  for (const listener of process.listeners('unhandledRejection'))
    if (!rejections.includes(listener)) process.removeListener('unhandledRejection', listener)
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
const start = async () => {
  await import('./index')
  await Promise.resolve()
  await Promise.resolve()
}
const event = () => ({ sender: state.windows[0].webContents, senderFrame: state.windows[0].webContents.mainFrame })
const requestClose = () => {
  state.windows[0].close()
  return state.send.mock.calls.at(-1)![1]
}
const reply = (input: unknown, sender = event()) => state.ipcEvents.get('lifecycle:close-result')!(sender, input)

describe('Electron startup and shutdown', () => {
  it('creates a secure window, starts jobs and installs trusted IPC', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    await start()
    expect(state.options[0].webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    })
    expect(state.loadURL).toHaveBeenCalledWith('http://localhost:5173')
    expect(state.resume).toHaveBeenCalledOnce()
    expect(state.register.mock.calls[0][2](event())).toBe(true)
    expect(state.register.mock.calls[0][2]({ sender: {} })).toBe(false)
    expect(state.popup.mock.calls[0][0]()).toEqual({ action: 'deny' })
    const preventDefault = vi.fn()
    state.webEvents.get('will-navigate')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    const secrets = state.service.mock.calls[0][6]
    expect(secrets.isEncryptionAvailable()).toBe(true)
    expect(secrets.decryptString(secrets.encryptString('key'))).toBe('key')
    state.appEvents.get('activate')!()
    expect(state.windows).toHaveLength(1)
    state.windows.length = 0
    state.appEvents.get('activate')!()
    expect(state.windows).toHaveLength(1)
  })
  it('loads the packaged renderer and logs load failures except aborted navigation', async () => {
    state.dev = false
    // Electron defines this property; Node's test process does not.
    vi.stubGlobal('__dirname', '/tmp/main')
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/tmp/resources' })
    await start()
    expect(state.loadFile).toHaveBeenCalledWith(expect.stringContaining('renderer/index.html'))
    state.webEvents.get('did-fail-load')!({}, -3, 'aborted', 'url', true)
    expect(state.record).not.toHaveBeenCalled()
    state.webEvents.get('did-fail-load')!({}, -2, 'offline', 'url', true)
    state.webEvents.get('render-process-gone')!({}, { reason: 'crashed', exitCode: 1 })
    expect(state.record).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ category: 'renderer.failed-load' })
    )
    expect(state.record).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ category: 'renderer.process-gone' })
    )
  })
  it('replays a pending close for readiness and ignores invalid acknowledgements', async () => {
    await start()
    const id = requestClose()
    requestClose()
    expect(state.send).toHaveBeenCalledTimes(1)
    state.ipcEvents.get('lifecycle:ready')!({ sender: {} })
    state.ipcEvents.get('lifecycle:ready')!(event())
    expect(state.send).toHaveBeenCalledTimes(2)
    for (const input of [null, 'bad', {}, { requestId: 'stale', saved: true }, { requestId: id, saved: 'yes' }])
      await reply(input)
    await reply({ requestId: id, saved: true }, { sender: {}, senderFrame: {} })
    await reply({ requestId: id, saved: true }, { ...event(), senderFrame: {} })
    expect(state.finish).not.toHaveBeenCalled()
    await reply({ requestId: id, saved: true })
    await reply({ requestId: id, saved: true })
    expect(state.finish).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(15000)
    expect(state.message).not.toHaveBeenCalled()
  })
  it('keeps the editor open after a rejected save or pending-write failure', async () => {
    await start()
    await reply({ requestId: requestClose(), saved: false })
    expect(state.finish).not.toHaveBeenCalled()
    state.finish.mockRejectedValueOnce(new Error('Disk full'))
    await reply({ requestId: requestClose(), saved: true })
    expect(state.message).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Disk full' }))
    expect(state.record).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ category: 'shutdown.pending-writes' })
    )
    expect(state.quit).not.toHaveBeenCalled()
  })
  it.each([0, 1, 2, 3])('handles recovery choice %s after saving times out', async (response) => {
    await start()
    state.message.mockResolvedValue({ response })
    requestClose()
    await vi.advanceTimersByTimeAsync(15000)
    expect(state.message).toHaveBeenCalledWith(state.windows[0], expect.objectContaining({ cancelId: 3 }))
    if (response === 0) expect(state.send).toHaveBeenCalledTimes(2)
    if (response === 1) expect(state.reload).toHaveBeenCalledOnce()
    if (response === 2) expect(state.finish).toHaveBeenCalledOnce()
    if (response === 3) {
      expect(state.finish).not.toHaveBeenCalled()
      expect(state.reload).not.toHaveBeenCalled()
    }
  })
  it('logs recovery errors and does not close without acknowledgement', async () => {
    await start()
    state.message.mockRejectedValueOnce(new Error('dialog failed'))
    requestClose()
    state.webEvents.get('render-process-gone')!({}, { reason: 'crashed', exitCode: 2 })
    await Promise.resolve()
    await Promise.resolve()
    expect(state.record).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ category: 'shutdown.recovery' })
    )
    expect(state.finish).not.toHaveBeenCalled()
  })
  it('requires a verified migration and trusted sender before restarting', async () => {
    await start()
    const restart = state.handlers.get('lifecycle:restart')!
    expect(() => restart({ sender: {} })).toThrow('Invalid restart sender')
    state.migration.mockReturnValueOnce({ state: 'idle' })
    expect(() => restart(event())).toThrow('No verified move')
    restart(event())
    await reply({ requestId: state.send.mock.calls.at(-1)![1], saved: true })
    expect(state.relaunch).toHaveBeenCalledOnce()
    expect(state.quit).toHaveBeenCalledOnce()
  })
  it('waits for saves before quitting and closes the database on approved quit', async () => {
    await start()
    const preventDefault = vi.fn()
    state.appEvents.get('before-quit')!({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(state.dbClose).not.toHaveBeenCalled()
    await reply({ requestId: state.send.mock.calls.at(-1)![1], saved: true })
    expect(state.quit).toHaveBeenCalledOnce()
    state.appEvents.get('before-quit')!({ preventDefault })
    expect(state.dbClose).toHaveBeenCalledOnce()
    state.appEvents.get('window-all-closed')!()
    if (process.platform !== 'darwin') expect(state.quit).toHaveBeenCalledTimes(2)
  })
  it.each([new Error('database failed'), 'database failed'])(
    'reports startup failure to fallback storage and quits',
    async (failure) => {
      state.database.mockImplementation(() => {
        throw failure
      })
      await start()
      await Promise.resolve()
      expect(state.fallback).toHaveBeenCalledWith(
        expect.stringContaining('fallback.ndjson'),
        failure,
        expect.objectContaining({ category: 'startup.database' })
      )
      expect(state.message).toHaveBeenCalledWith(expect.objectContaining({ detail: 'database failed' }))
      expect(state.quit).toHaveBeenCalledOnce()
      expect(state.windows).toHaveLength(0)
    }
  )
})
