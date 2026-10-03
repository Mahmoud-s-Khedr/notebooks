import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
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
  const dataDirectory = app.getPath('userData')
  database = new NotebookDatabase(join(dataDirectory, 'database.sqlite'))
  // Secrets are stored only in the app-data config directory; recordings remain under managed assets.
  const executable = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  // Sidecar resolution stays in main; renderer receives availability only.
  const candidate = is.dev ? join(process.cwd(), 'resources', 'whisper.cpp', process.platform, executable) : join(process.resourcesPath, 'whisper.cpp', process.platform, executable)
  const service = new NotebookService(database, join(dataDirectory, 'assets'), join(dataDirectory, 'config'), { binaryPath: existsSync(candidate) ? candidate : null, modelPath: null })
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
