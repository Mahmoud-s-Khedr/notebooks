import { contextBridge, ipcRenderer } from 'electron'
import type { ResearchNotebookApi } from '../shared/domain'

const api: ResearchNotebookApi = {
  notebooks: {
    list: () => ipcRenderer.invoke('notebooks:list'),
    create: (input) => ipcRenderer.invoke('notebooks:create', input),
    update: (input) => ipcRenderer.invoke('notebooks:update', input)
  },
  pages: {
    create: (input) => ipcRenderer.invoke('pages:create', input),
    update: (input) => ipcRenderer.invoke('pages:update', input),
    getWorkspace: (input) => ipcRenderer.invoke('pages:get-workspace', input)
  },
  notes: {
    create: (input) => ipcRenderer.invoke('notes:create', input),
    update: (input) => ipcRenderer.invoke('notes:update', input),
    duplicate: (input) => ipcRenderer.invoke('notes:duplicate', input)
  },
  blocks: {
    create: (input) => ipcRenderer.invoke('blocks:create', input),
    update: (input) => ipcRenderer.invoke('blocks:update', input),
    updateType: (input) => ipcRenderer.invoke('blocks:update-type', input),
    duplicate: (input) => ipcRenderer.invoke('blocks:duplicate', input),
    reorder: (input) => ipcRenderer.invoke('blocks:reorder', input)
  },
  assets: {
    import: (input) => ipcRenderer.invoke('assets:import', input),
    list: (input) => ipcRenderer.invoke('assets:list', input),
    dataUrl: (input) => ipcRenderer.invoke('assets:data-url', input),
    attach: (input) => ipcRenderer.invoke('assets:attach', input),
    diagnostics: (input) => ipcRenderer.invoke('assets:diagnostics', input),
    remove: (input) => ipcRenderer.invoke('assets:remove', input),
    saveRecording: (input) => ipcRenderer.invoke('assets:save-recording', input),
    requestThumbnail: (input) => ipcRenderer.invoke('assets:request-thumbnail', input),
    thumbnailDataUrl: (input) => ipcRenderer.invoke('assets:thumbnail-data-url', input)
  },
  transcription: {
    create: (input) => ipcRenderer.invoke('transcription:create', input),
    get: (input) => ipcRenderer.invoke('transcription:get', input),
    list: (input) => ipcRenderer.invoke('transcription:list', input),
    retry: (input) => ipcRenderer.invoke('transcription:retry', input)
  },
  settings: {
    preferences: () => ipcRenderer.invoke('settings:preferences'),
    updatePreferences: (input) => ipcRenderer.invoke('settings:preferences:update', input),
    transcription: () => ipcRenderer.invoke('settings:transcription'),
    setOpenRouterKey: (input) => ipcRenderer.invoke('settings:openrouter-key', input),
    removeOpenRouterKey: () => ipcRenderer.invoke('settings:openrouter-key:remove'),
    models: () => ipcRenderer.invoke('settings:models'),
    downloadModel: (input) => ipcRenderer.invoke('settings:models:download', input),
    cancelModelDownload: (input) => ipcRenderer.invoke('settings:models:cancel', input),
    removeModel: (input) => ipcRenderer.invoke('settings:models:remove', input),
    setDefaultModel: (input) => ipcRenderer.invoke('settings:models:default', input),
    storage: () => ipcRenderer.invoke('settings:storage'),
    moveLibrary: () => ipcRenderer.invoke('settings:migration:start'),
    migrationStatus: () => ipcRenderer.invoke('settings:migration:status'),
    removeOldLibrary: () => ipcRenderer.invoke('settings:migration:remove-old')
  },
  exports: { start: (input) => ipcRenderer.invoke('exports:start', input) },
  jobs: {
    list: () => ipcRenderer.invoke('jobs:list'),
    cancel: (input) => ipcRenderer.invoke('jobs:cancel', input),
    retry: (input) => ipcRenderer.invoke('jobs:retry', input)
  },
  backups: { start: () => ipcRenderer.invoke('backups:start') },
  diagnostics: {
    list: () => ipcRenderer.invoke('diagnostics:list'),
    listErrors: (input) => ipcRenderer.invoke('diagnostics:list-errors', input),
    getError: (input) => ipcRenderer.invoke('diagnostics:get-error', input),
    reportError: (input) => ipcRenderer.invoke('diagnostics:report-error', input),
    export: () => ipcRenderer.invoke('diagnostics:export')
  },
  imports: { start: () => ipcRenderer.invoke('imports:start') },
  sources: {
    importPdf: (input) => ipcRenderer.invoke('sources:import-pdf', input),
    list: (input) => ipcRenderer.invoke('sources:list', input),
    getBlockSource: (input) => ipcRenderer.invoke('sources:get-block-source', input),
    captureText: (input) => ipcRenderer.invoke('sources:capture-text', input),
    captureRegion: (input) => ipcRenderer.invoke('sources:capture-region', input),
    createQaNote: (input) => ipcRenderer.invoke('sources:create-qa-note', input)
  },
  relations: {
    list: (input) => ipcRenderer.invoke('relations:list', input),
    create: (input) => ipcRenderer.invoke('relations:create', input),
    remove: (input) => ipcRenderer.invoke('relations:remove', input)
  },
  trash: {
    list: () => ipcRenderer.invoke('trash:list'),
    move: (input) => ipcRenderer.invoke('trash:move', input),
    restore: (input) => ipcRenderer.invoke('trash:restore', input),
    permanentlyDelete: (input) => ipcRenderer.invoke('trash:permanently-delete', input),
    empty: () => ipcRenderer.invoke('trash:empty')
  },
  search: (input) => ipcRenderer.invoke('search', input)
}

contextBridge.exposeInMainWorld('researchNotebook', api)

// This is deliberately best-effort: diagnostics must never alter normal renderer behavior.
const report = (input: Parameters<ResearchNotebookApi['diagnostics']['reportError']>[0]) => {
  void ipcRenderer.invoke('diagnostics:report-error', input).catch(() => undefined)
}
window.addEventListener('error', (event) =>
  report({
    severity: 'error',
    category: 'window.error',
    message: event.message || 'Unhandled renderer error',
    stack: event.error instanceof Error ? event.error.stack : undefined,
    context: { filename: event.filename, line: event.lineno, column: event.colno }
  })
)
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  report({
    severity: 'error',
    category: 'window.unhandledrejection',
    message: reason instanceof Error ? reason.message : String(reason ?? 'Unhandled promise rejection'),
    stack: reason instanceof Error ? reason.stack : undefined
  })
})
