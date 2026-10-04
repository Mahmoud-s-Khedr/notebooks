import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { is } from '@electron-toolkit/utils'
import { NotebookDatabase } from './database/database'
import { registerNotebookIpc } from './ipc/register-notebook-ipc'
import { NotebookService } from './services/notebook-service'

let mainWindow: BrowserWindow | undefined
let database: NotebookDatabase | undefined

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const defaultDataDirectory = app.getPath('userData')
  // This bootstrap pointer deliberately stays at Electron's default user-data path.
  // It is the only state not moved with a library and lets startup validate a move.
  const bootstrapPath = join(defaultDataDirectory, 'library-bootstrap.json')
  let dataDirectory = defaultDataDirectory; let previousRoot: string | null = null
  try {
    const pointer = JSON.parse(readFileSync(bootstrapPath, 'utf8')) as { activeRoot?: unknown; previousRoot?: unknown }
    if (typeof pointer.activeRoot === 'string' && existsSync(join(pointer.activeRoot, 'database.sqlite'))) { dataDirectory = pointer.activeRoot; previousRoot = typeof pointer.previousRoot === 'string' ? pointer.previousRoot : null }
  } catch { /* First launch or an interrupted move: keep using the existing library. */ }
  database = new NotebookDatabase(join(dataDirectory, 'database.sqlite'))
  // Secrets are stored only in the app-data config directory; recordings remain under managed assets.
  const executable = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  // Sidecar resolution stays in main; renderer receives availability only.
  const candidate = is.dev ? join(process.cwd(), 'resources', 'whisper.cpp', process.platform, executable) : join(process.resourcesPath, 'whisper.cpp', process.platform, executable)
  const service = new NotebookService(database, join(dataDirectory, 'assets'), join(dataDirectory, 'config'), { binaryPath: existsSync(candidate) ? candidate : null, modelPath: null }, { root: dataDirectory, bootstrapPath, previousRoot })
  registerNotebookIpc(service)
  service.resumeJobs()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch(async (error: unknown) => {
  await dialog.showMessageBox({
    type: 'error',
    title: 'Research Notebook could not start',
    message: 'Unable to initialize the local notebook database.',
    detail: error instanceof Error ? error.message : String(error)
  })
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => database?.close())
