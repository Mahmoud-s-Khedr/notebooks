import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { is } from '@electron-toolkit/utils'
import { NotebookDatabase } from './database/database'
import { registerNotebookIpc } from './ipc/register-notebook-ipc'
import { NotebookService } from './services/notebook-service'
import { ErrorLogService, appendFallbackError } from './services/error-log-service'
import { resolveLibraryBootstrap } from './library-bootstrap'

// Set the production profile before Chromium or library bootstrap reads it.
// Nightly and development keep their existing libraries untouched.
if (app.isPackaged) {
  const profile =
    app.getName() === 'Research Notebook Production' ? 'research-notebook-production' : 'research-notebook'
  app.setPath('userData', join(app.getPath('appData'), profile))
}
if (process.platform === 'win32' && app.isPackaged) {
  app.setAppUserModelId(
    app.getName() === 'Research Notebook Production'
      ? 'com.researchnotebook.app.production'
      : 'com.researchnotebook.app'
  )
}

let closeTimer: ReturnType<typeof setTimeout> | undefined
let recoveringClose = false
let closeRequest: string | null = null
let closeAcknowledged = false
let closeApproved = false
let restartRequested = false
let quitRequested = false
let notebookService: NotebookService | undefined
let mainWindow: BrowserWindow | undefined
let database: NotebookDatabase | undefined
let errors: ErrorLogService | undefined
let fallbackPath: string | undefined

function reportStartupError(
  error: unknown,
  category: string,
  severity: 'error' | 'fatal' = 'fatal',
  context: Record<string, unknown> = {}
): void {
  if (errors) errors.record(error, { severity, process: 'lifecycle', layer: 'electron', category, context })
  else {
    let path = fallbackPath
    try {
      path ??= join(app.getPath('userData'), 'error-events-fallback.ndjson')
    } catch {
      /* Electron path is not available yet. */
    }
    if (path) appendFallbackError(path, error, { severity, process: 'lifecycle', layer: 'electron', category, context })
  }
}

async function recoverClose(): Promise<void> {
  if (!closeRequest || closeAcknowledged || recoveringClose || !mainWindow) return
  recoveringClose = true
  clearTimeout(closeTimer)
  const request = closeRequest
  try {
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Saving has not finished',
      message: 'The editor has not acknowledged saving. Unsaved changes may be lost.',
      buttons: ['Retry saving', 'Reload editor', 'Close with unsaved changes', 'Keep open'],
      defaultId: 0,
      cancelId: 3
    })
    if (closeRequest !== request || closeAcknowledged) return
    closeRequest = null
    if (choice.response === 0) mainWindow.close()
    else if (choice.response === 1) {
      restartRequested = false
      quitRequested = false
      mainWindow.reload()
    } else if (choice.response === 2) {
      await notebookService?.finishPendingWrites()
      closeApproved = true
      mainWindow.close()
      if (restartRequested) app.relaunch()
      if (restartRequested || quitRequested) app.quit()
    } else {
      restartRequested = false
      quitRequested = false
    }
  } catch (error) {
    reportStartupError(error, 'shutdown.recovery', 'error')
  } finally {
    recoveringClose = false
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    icon: join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources/logo.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  closeApproved = false
  mainWindow.on('close', (event) => {
    if (closeApproved) return
    event.preventDefault()
    if (closeRequest) return
    closeRequest = randomUUID()
    closeAcknowledged = false
    mainWindow?.webContents.send('lifecycle:save-before-close', closeRequest)
    closeTimer = setTimeout(() => void recoverClose(), 15000)
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    reportStartupError(new Error(`Renderer process exited: ${details.reason}`), 'renderer.process-gone', 'fatal', {
      reason: details.reason,
      exitCode: details.exitCode
    })
    if (closeRequest) void recoverClose()
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode !== -3)
      reportStartupError(new Error(errorDescription), 'renderer.failed-load', 'error', {
        errorCode,
        validatedURL,
        isMainFrame
      })
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app
  .whenReady()
  .then(() => {
    const defaultDataDirectory = app.getPath('userData')
    fallbackPath = join(defaultDataDirectory, 'error-events-fallback.ndjson')
    // This bootstrap pointer deliberately stays at Electron's default user-data path.
    // It is the only state not moved with a library and lets startup validate a move.
    const bootstrapPath = join(defaultDataDirectory, 'library-bootstrap.json')
    const bootstrap = resolveLibraryBootstrap(defaultDataDirectory, bootstrapPath)
    const dataDirectory = bootstrap.activeRoot
    const previousRoot = bootstrap.previousRoot
    database = new NotebookDatabase(join(dataDirectory, 'database.sqlite'))
    errors = new ErrorLogService(
      database.connection,
      fallbackPath,
      app.getVersion(),
      is.dev || Boolean(process.env.DEBUG)
    )
    // Secrets are stored only in the app-data config directory; recordings remain under managed assets.
    const executable = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
    // Sidecar resolution stays in main; renderer receives availability only.
    const candidate = is.dev
      ? join(process.cwd(), 'resources', 'whisper.cpp', process.platform, executable)
      : join(process.resourcesPath, 'whisper.cpp', process.platform, executable)
    const service = new NotebookService(
      database,
      join(dataDirectory, 'assets'),
      join(dataDirectory, 'config'),
      { binaryPath: existsSync(candidate) ? candidate : null, modelPath: null },
      { root: dataDirectory, bootstrapPath, previousRoot },
      errors,
      {
        isEncryptionAvailable: () =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
        encryptString: (value) => safeStorage.encryptString(value),
        decryptString: (value) => safeStorage.decryptString(value)
      }
    )
    notebookService = service
    registerNotebookIpc(service, errors, (event) => event.sender === mainWindow?.webContents)
    service.resumeJobs()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch(async (error: unknown) => {
    reportStartupError(error, 'startup.database')
    await dialog.showMessageBox({
      type: 'error',
      title: 'Research Notebook could not start',
      message: 'Unable to initialize the local notebook database.',
      detail: error instanceof Error ? error.message : String(error)
    })
    app.quit()
  })

process.on('uncaughtException', (error) => reportStartupError(error, 'process.uncaughtException'))
process.on('unhandledRejection', (reason) => reportStartupError(reason, 'process.unhandledRejection'))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.on('lifecycle:ready', (event) => {
  if (
    event.sender === mainWindow?.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame &&
    closeRequest &&
    !closeAcknowledged
  )
    mainWindow.webContents.send('lifecycle:save-before-close', closeRequest)
})
ipcMain.on('lifecycle:close-result', async (event, input: unknown) => {
  if (
    event.sender !== mainWindow?.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !input ||
    typeof input !== 'object'
  )
    return
  const response = input as { requestId?: unknown; saved?: unknown }
  if (!closeRequest || closeAcknowledged || response.requestId !== closeRequest || typeof response.saved !== 'boolean')
    return
  closeAcknowledged = true
  clearTimeout(closeTimer)
  if (!response.saved) {
    closeRequest = null
    restartRequested = false
    quitRequested = false
    return
  }
  try {
    await notebookService?.finishPendingWrites()
  } catch (error) {
    closeRequest = null
    reportStartupError(error, 'shutdown.pending-writes', 'error')
    restartRequested = false
    quitRequested = false
    await dialog.showMessageBox({
      type: 'error',
      message: 'Unable to finish background writes. The library remains open.',
      detail: error instanceof Error ? error.message : String(error)
    })
    return
  }
  closeRequest = null
  closeApproved = true
  mainWindow?.close()
  if (restartRequested) {
    app.relaunch()
    app.quit()
  } else if (quitRequested) app.quit()
})
ipcMain.handle('lifecycle:restart', (event) => {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame)
    throw new Error('Invalid restart sender.')
  if (notebookService?.migrationStatus().state !== 'pending-restart')
    throw new Error('No verified move is awaiting restart.')
  restartRequested = true
  mainWindow.close()
})
app.on('before-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && !closeApproved) {
    event.preventDefault()
    quitRequested = true
    mainWindow.close()
    return
  }
  database?.close()
})
