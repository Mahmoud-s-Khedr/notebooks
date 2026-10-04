import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  BookOpen,
  ChevronDown,
  FilePlus2,
  FolderPlus,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  Search,
  Trash2
} from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type {
  AppPreferences,
  ErrorEvent,
  ErrorProcess,
  ErrorSeverity,
  Job,
  NotebookTree,
  PageWorkspace,
  SearchResult,
  StorageSummary,
  TrashRecord,
  WhisperModel
} from '../../shared/domain'
import { Button, DropdownMenu, IconTip, Input, Modal } from './components/ui'
import { PageWorkspace as EditorWorkspace } from './features/editor/PageWorkspace'
import { SourceWorkspace } from './features/sources/SourceWorkspace'

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'The requested change could not be saved.'
type Utility = 'settings' | 'diagnostics' | 'export' | 'jobs' | 'trash' | null
const applyAppearance = (preferences: AppPreferences) => {
  document.documentElement.dataset.theme = preferences.theme
  document.documentElement.dataset.density = preferences.density
}

export function App(): ReactElement {
  const [notebooks, setNotebooks] = useState<NotebookTree[]>([])
  const [workspace, setWorkspace] = useState<PageWorkspace | null>(null)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [mode, setMode] = useState<'write' | 'research'>('write')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [utility, setUtility] = useState<Utility>(null)
  const [trash, setTrash] = useState<TrashRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const refreshTree = useCallback(async () => setNotebooks(await window.researchNotebook.notebooks.list()), [])
  const refreshTrash = useCallback(async () => setTrash(await window.researchNotebook.trash.list()), [])
  const openPage = useCallback(async (pageId: string, cursor?: string) => {
    setError(null)
    setSelectedPageId(pageId)
    setActiveNoteId(null)
    setWorkspace(await window.researchNotebook.pages.getWorkspace({ pageId, cursor }))
  }, [])
  const reloadWorkspace = useCallback(async () => {
    if (selectedPageId) {
      setWorkspace(await window.researchNotebook.pages.getWorkspace({ pageId: selectedPageId }))
      setActiveNoteId(null)
    }
  }, [selectedPageId])
  const trashChanged = useCallback(async () => {
    await Promise.all([refreshTree(), refreshTrash()])
    if (selectedPageId)
      try {
        await reloadWorkspace()
      } catch {
        setWorkspace(null)
        setSelectedPageId(null)
      }
  }, [refreshTree, refreshTrash, reloadWorkspace, selectedPageId])
  useEffect(() => {
    void refreshTree().catch((error: unknown) => setError(errorMessage(error)))
  }, [refreshTree])
  useEffect(() => {
    void window.researchNotebook.settings
      .preferences()
      .then(applyAppearance)
      .catch((value: unknown) => setError(errorMessage(value)))
  }, [])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
        requestAnimationFrame(() => searchInput.current?.focus())
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'n' && workspace) {
        event.preventDefault()
        void window.researchNotebook.notes
          .create({ pageId: workspace.id, title: 'Untitled note' })
          .then(reloadWorkspace)
          .catch((error: unknown) => setError(errorMessage(error)))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [workspace, reloadWorkspace])
  const search = async (value = query) => {
    try {
      setResults(value.trim() ? await window.researchNotebook.search({ query: value }) : [])
    } catch (error) {
      setError(errorMessage(error))
    }
  }
  const selectResult = async (result: SearchResult) => {
    try {
      if (result.pageId)
        await openPage(
          result.pageId,
          result.notePosition && result.notePosition > 0 ? String(result.notePosition - 1) : undefined
        )
      else if (result.notebookId) {
        const notebook = notebooks.find(({ id }) => id === result.notebookId)
        if (notebook?.pages[0]) await openPage(notebook.pages[0].id)
      }
      setPaletteOpen(false)
    } catch (error) {
      setError(errorMessage(error))
    }
  }
  const createNotebook = async () => {
    try {
      const notebook = await window.researchNotebook.notebooks.create({ title: 'Untitled notebook' })
      const page = await window.researchNotebook.pages.create({ notebookId: notebook.id, title: 'Untitled page' })
      await refreshTree()
      await openPage(page.id)
    } catch (error) {
      setError(errorMessage(error))
    }
  }
  const notebookId = selectedPageId
    ? (notebooks.find((notebook) => notebook.pages.some(({ id }) => id === selectedPageId))?.id ?? null)
    : null
  const openUtility = async (kind: Utility) => {
    if (kind === 'trash')
      try {
        await refreshTrash()
      } catch (error) {
        setError(errorMessage(error))
        return
      }
    setUtility(kind)
  }
  const editor = workspace && (
    <EditorWorkspace
      workspace={workspace}
      notebookId={notebookId}
      mode={mode}
      reloadWorkspace={reloadWorkspace}
      loadMore={async () => {
        if (!workspace.nextCursor) return
        const next = await window.researchNotebook.pages.getWorkspace({
          pageId: workspace.id,
          cursor: workspace.nextCursor
        })
        setWorkspace({ ...next, notes: [...workspace.notes, ...next.notes] })
      }}
      activeNoteId={activeNoteId}
      setActiveNoteId={setActiveNoteId}
      onError={(error) => setError(errorMessage(error))}
      onChanged={refreshTree}
      onTrashed={trashChanged}
      onViewSource={() => setMode('research')}
      onUtilities={openUtility}
    />
  )
  return (
    <main className={`app-shell ${mode}-mode ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {!sidebarCollapsed && (
        <NotebookSidebar
          notebooks={notebooks}
          selectedPageId={selectedPageId}
          onOpenPage={openPage}
          onRefresh={refreshTree}
          onError={(error) => setError(errorMessage(error))}
          onTrashed={trashChanged}
          onNewNotebook={createNotebook}
        />
      )}
      <section className="application-main">
        <header className="app-toolbar">
          <IconTip label="Collapse sidebar">
            <Button variant="icon" aria-label="Collapse notebook sidebar" onClick={() => setSidebarCollapsed(true)}>
              <PanelLeftClose size={18} />
            </Button>
          </IconTip>
          <button className="command-search" onClick={() => setPaletteOpen(true)}>
            <Search size={17} />
            <span>Search notes, sources, or ask…</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="workspace-switcher" aria-label="Workspace mode">
            <button
              className={mode === 'research' ? 'selected' : ''}
              aria-pressed={mode === 'research'}
              onClick={() => setMode('research')}
            >
              <BookOpen size={15} /> Research
            </button>
            <button
              className={mode === 'write' ? 'selected' : ''}
              aria-pressed={mode === 'write'}
              onClick={() => setMode('write')}
            >
              Write
            </button>
          </div>
          <AppMenu
            openUtility={openUtility}
            reloadWorkspace={reloadWorkspace}
            onError={(error) => setError(errorMessage(error))}
          />
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              Dismiss
            </Button>
          </div>
        )}
        {utility === 'settings' ? (
          <SettingsPage
            notebookId={notebookId}
            onClose={() => setUtility(null)}
            onError={(value) => setError(errorMessage(value))}
          />
        ) : workspace ? (
          mode === 'research' ? (
            <Group className="research-layout" orientation="horizontal">
              <Panel id="source" defaultSize="42" minSize="30" maxSize="55">
                <section className="source-pane">
                  <SourceWorkspace
                    notebookId={notebookId}
                    workspace={workspace}
                    activeNoteId={activeNoteId}
                    onSaved={reloadWorkspace}
                    onError={(error) => setError(errorMessage(error))}
                    onUtilities={openUtility}
                  />
                </section>
              </Panel>
              <Separator className="pane-resize" />
              <Panel id="editor" minSize="45">
                <section className="editor-pane">{editor}</section>
              </Panel>
            </Group>
          ) : (
            <div className="write-layout">{editor}</div>
          )
        ) : (
          <Empty onNewNotebook={createNotebook} />
        )}
      </section>
      {sidebarCollapsed && (
        <Button
          className="sidebar-reopen"
          variant="icon"
          aria-label="Expand notebook sidebar"
          onClick={() => setSidebarCollapsed(false)}
        >
          <Menu size={18} />
        </Button>
      )}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        query={query}
        setQuery={setQuery}
        results={results}
        onSearch={search}
        onSelect={selectResult}
        inputRef={searchInput}
      />
      <UtilityDialogs
        utility={utility}
        onOpenChange={(open) => !open && setUtility(null)}
        notebookId={notebookId}
        workspace={workspace}
        activeNoteId={activeNoteId}
        trash={trash}
        onChanged={trashChanged}
        onError={(error) => setError(errorMessage(error))}
      />
    </main>
  )
}

function AppMenu({
  openUtility,
  reloadWorkspace,
  onError
}: {
  openUtility: (kind: Utility) => Promise<void>
  reloadWorkspace: () => Promise<void>
  onError: (error: unknown) => void
}): ReactElement {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="icon" aria-label="Application menu">
          <MoreHorizontal size={18} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu-content" align="end">
          <DropdownMenu.Item
            className="menu-item"
            onSelect={() => void window.researchNotebook.imports.start().then(reloadWorkspace).catch(onError)}
          >
            Import backup
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="menu-item"
            onSelect={() => void window.researchNotebook.backups.start().catch(onError)}
          >
            Back up library
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-separator" />
          {(['jobs', 'diagnostics', 'settings', 'trash'] as const).map((kind) => (
            <DropdownMenu.Item key={kind} className="menu-item" onSelect={() => void openUtility(kind)}>
              {kind}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function NotebookSidebar({
  notebooks,
  selectedPageId,
  onOpenPage,
  onRefresh,
  onError,
  onTrashed,
  onNewNotebook
}: {
  notebooks: NotebookTree[]
  selectedPageId: string | null
  onOpenPage: (id: string) => Promise<void>
  onRefresh: () => Promise<void>
  onError: (error: unknown) => void
  onTrashed: () => Promise<void>
  onNewNotebook: () => Promise<void>
}): ReactElement {
  const [newPage, setNewPage] = useState('')
  const createPage = async (notebookId: string) => {
    try {
      const page = await window.researchNotebook.pages.create({ notebookId, title: newPage.trim() || 'Untitled page' })
      setNewPage('')
      await onRefresh()
      await onOpenPage(page.id)
    } catch (error) {
      onError(error)
    }
  }
  return (
    <aside className="sidebar" aria-label="Notebooks">
      <div className="product-name">
        <BookOpen size={20} />
        Research Notebook
      </div>
      <div className="sidebar-search">
        <Search size={16} />
        <input aria-label="Filter notebook pages" placeholder="Search notes…" />
        <kbd>⌘ K</kbd>
      </div>
      <div className="sidebar-label">
        MY NOTEBOOK <ChevronDown size={14} />
      </div>
      <nav>
        {notebooks.map((notebook) => (
          <section className="notebook-tree" key={notebook.id}>
            <div className="tree-title">
              <FolderPlus size={14} />
              <input
                aria-label="Notebook title"
                defaultValue={notebook.title}
                onBlur={(event) => {
                  if (event.currentTarget.value.trim() !== notebook.title)
                    void window.researchNotebook.notebooks
                      .update({ notebookId: notebook.id, title: event.currentTarget.value })
                      .then(onRefresh)
                      .catch(onError)
                }}
              />
              <button
                aria-label={`Move ${notebook.title} to trash`}
                onClick={() =>
                  void window.researchNotebook.trash
                    .move({ entityType: 'notebook', id: notebook.id })
                    .then(onTrashed)
                    .catch(onError)
                }
              >
                <Trash2 size={13} />
              </button>
            </div>
            {notebook.pages.map((page) => (
              <button
                key={page.id}
                className={`page-link ${page.id === selectedPageId ? 'active' : ''}`}
                aria-current={page.id === selectedPageId ? 'page' : undefined}
                onClick={() => void onOpenPage(page.id).catch(onError)}
              >
                {page.title}
              </button>
            ))}
            <div className="new-page">
              <input
                aria-label={`New page for ${notebook.title}`}
                value={newPage}
                onChange={(event) => setNewPage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void createPage(notebook.id)
                }}
                placeholder="New page"
              />
              <button aria-label="Create page" onClick={() => void createPage(notebook.id)}>
                <FilePlus2 size={15} />
              </button>
            </div>
          </section>
        ))}
      </nav>
      <Button className="new-notebook" variant="secondary" onClick={() => void onNewNotebook()}>
        <FolderPlus size={16} /> New notebook
      </Button>
    </aside>
  )
}

function CommandPalette({
  open,
  onOpenChange,
  query,
  setQuery,
  results,
  onSearch,
  onSelect,
  inputRef
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  setQuery: (query: string) => void
  results: SearchResult[]
  onSearch: (query?: string) => Promise<void>
  onSelect: (result: SearchResult) => Promise<void>
  inputRef: React.RefObject<HTMLInputElement | null>
}): ReactElement {
  return (
    <Modal title="Search your notebook" open={open} onOpenChange={onOpenChange}>
      <div className="command-palette">
        <div className="palette-input">
          <Search size={18} />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              void onSearch(event.target.value)
            }}
            placeholder="Search notes, sources, or ask…"
          />
        </div>
        {results.length ? (
          <div className="search-results">
            {results.map((result) => (
              <button key={`${result.entityType}-${result.entityId}`} onClick={() => void onSelect(result)}>
                <strong>{result.title}</strong>
                <small>
                  {result.entityType} · {result.excerpt || 'Match'}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <p className="palette-empty">Start typing to search pages, notes, and blocks.</p>
        )}
      </div>
    </Modal>
  )
}

function UtilityDialogs({
  utility,
  onOpenChange,
  notebookId,
  workspace,
  activeNoteId,
  trash,
  onChanged,
  onError
}: {
  utility: Utility
  onOpenChange: (open: boolean) => void
  notebookId: string | null
  workspace: PageWorkspace | null
  activeNoteId: string | null
  trash: TrashRecord[]
  onChanged: () => Promise<void>
  onError: (error: unknown) => void
}): ReactElement {
  return (
    <>
      {utility === 'jobs' && <JobsDialog onOpenChange={onOpenChange} onError={onError} />}
      {utility === 'diagnostics' && (
        <DiagnosticsDialog notebookId={notebookId} onOpenChange={onOpenChange} onError={onError} />
      )}
      {utility === 'export' && (
        <ExportDialog
          notebookId={notebookId}
          workspace={workspace}
          activeNoteId={activeNoteId}
          onOpenChange={onOpenChange}
          onError={onError}
        />
      )}
      {utility === 'trash' && (
        <TrashDialog records={trash} onOpenChange={onOpenChange} onChanged={onChanged} onError={onError} />
      )}
    </>
  )
}
const bytes = (value: number) =>
  value < 1_000_000
    ? `${Math.round(value / 1000)} KB`
    : `${(value / 1_000_000_000).toFixed(value > 1_000_000_000 ? 1 : 2)} GB`
function SettingsPage({
  notebookId,
  onClose,
  onError
}: {
  notebookId: string | null
  onClose: () => void
  onError: (error: unknown) => void
}): ReactElement {
  const [section, setSection] = useState<'general' | 'transcription' | 'storage' | 'maintenance'>('general')
  const [preferences, setPreferences] = useState<AppPreferences>({ theme: 'system', density: 'default' })
  const [configured, setConfigured] = useState(false)
  const [key, setKey] = useState('')
  const [models, setModels] = useState<WhisperModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [storage, setStorage] = useState<StorageSummary | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [maintenance, setMaintenance] = useState('')
  const load = useCallback(async () => {
    const [prefs, transcription, modelList, summary, jobList] = await Promise.all([
      window.researchNotebook.settings.preferences(),
      window.researchNotebook.settings.transcription(),
      window.researchNotebook.settings.models(),
      window.researchNotebook.settings.storage(),
      window.researchNotebook.jobs.list()
    ])
    setPreferences(prefs)
    applyAppearance(prefs)
    setConfigured(transcription.openRouterConfigured)
    setSelectedModel(transcription.selectedLocalModel?.id ?? null)
    setModels(modelList)
    setStorage(summary)
    setJobs(jobList)
  }, [])
  useEffect(() => {
    void load().catch(onError)
    const timer = window.setInterval(() => void load().catch(onError), 1100)
    return () => window.clearInterval(timer)
  }, [load, onError])
  const savePreferences = async (input: Partial<AppPreferences>) => {
    try {
      const next = await window.researchNotebook.settings.updatePreferences(input)
      setPreferences(next)
      applyAppearance(next)
    } catch (error) {
      onError(error)
    }
  }
  const saveKey = async () => {
    try {
      await window.researchNotebook.settings.setOpenRouterKey({ key })
      setKey('')
      setConfigured(true)
    } catch (error) {
      onError(error)
    }
  }
  const scan = async () => {
    if (!notebookId) return
    try {
      const report = await window.researchNotebook.assets.diagnostics({ notebookId })
      setMaintenance(
        `${report.missing.length} missing · ${report.orphaned.length} unreferenced · ${report.untrackedFiles.length} untracked`
      )
    } catch (error) {
      onError(error)
    }
  }
  return (
    <section className="settings-page" aria-label="Settings">
      <header className="settings-header">
        <div>
          <span className="eyebrow">Application</span>
          <h1>Settings</h1>
          <p>Preferences and local library controls.</p>
        </div>
        <Button variant="secondary" onClick={onClose}>
          Back to workspace
        </Button>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {(
            [
              ['general', 'General'],
              ['transcription', 'Transcription'],
              ['storage', 'Library & Storage'],
              ['maintenance', 'Maintenance']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={section === id ? 'active' : ''}
              aria-current={section === id ? 'page' : undefined}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {section === 'general' && (
            <section className="settings-section">
              <h2>General</h2>
              <label className="field-label">
                Appearance
                <select
                  value={preferences.theme}
                  onChange={(event) => void savePreferences({ theme: event.target.value as AppPreferences['theme'] })}
                >
                  <option value="system">Use system setting</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label className="field-label">
                Layout density
                <select
                  value={preferences.density}
                  onChange={(event) =>
                    void savePreferences({ density: event.target.value as AppPreferences['density'] })
                  }
                >
                  <option value="default">Default</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
            </section>
          )}
          {section === 'transcription' && (
            <section className="settings-section">
              <h2>Transcription</h2>
              <div className="settings-card">
                <h3>OpenRouter</h3>
                <p>{configured ? 'An API key is configured locally.' : 'No API key is configured.'}</p>
                <label className="field-label">
                  {configured ? 'Replace API key' : 'API key'}
                  <Input
                    type="password"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    placeholder="Enter API key"
                  />
                </label>
                <div className="dialog-actions">
                  <Button disabled={!key.trim()} onClick={() => void saveKey()}>
                    {configured ? 'Replace key' : 'Save key'}
                  </Button>
                  {configured && (
                    <Button
                      variant="danger"
                      onClick={() => {
                        if (window.confirm('Remove the saved OpenRouter key?'))
                          void window.researchNotebook.settings
                            .removeOpenRouterKey()
                            .then(() => setConfigured(false))
                            .catch(onError)
                      }}
                    >
                      Remove key
                    </Button>
                  )}
                </div>
              </div>
              <h3 className="settings-subheading">Local Whisper models</h3>
              <p className="dialog-copy">Choose one installed model as the default for new local transcriptions.</p>
              <div className="model-list">
                {models.map((model) => (
                  <div className="model-card" key={model.id}>
                    <div>
                      <strong>{model.displayName}</strong>
                      <small>
                        {bytes(model.sizeBytes)} ·{' '}
                        {model.installed
                          ? 'Installed'
                          : model.state === 'downloading'
                            ? `Downloading ${model.progress === null ? '' : `${Math.round(model.progress * 100)}%`}`
                            : model.state === 'failed'
                              ? model.error
                              : 'Not installed'}
                      </small>
                      {model.state === 'downloading' && <progress max="1" value={model.progress ?? undefined} />}
                    </div>
                    <div className="dialog-actions">
                      {model.installed && (
                        <Button
                          variant={selectedModel === model.id ? 'secondary' : 'primary'}
                          size="sm"
                          disabled={selectedModel === model.id}
                          onClick={() =>
                            void window.researchNotebook.settings
                              .setDefaultModel({ modelId: model.id })
                              .then(load)
                              .catch(onError)
                          }
                        >
                          {selectedModel === model.id ? 'Default' : 'Use as default'}
                        </Button>
                      )}
                      {!model.installed && model.state !== 'downloading' && (
                        <Button
                          size="sm"
                          onClick={() =>
                            void window.researchNotebook.settings
                              .downloadModel({ modelId: model.id })
                              .then(load)
                              .catch(onError)
                          }
                        >
                          {model.state === 'failed' ? 'Retry' : 'Download'}
                        </Button>
                      )}
                      {model.state === 'downloading' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void window.researchNotebook.settings
                              .cancelModelDownload({ modelId: model.id })
                              .then(load)
                              .catch(onError)
                          }
                        >
                          Cancel
                        </Button>
                      )}
                      {model.installed && selectedModel !== model.id && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(`Remove ${model.displayName}?`))
                              void window.researchNotebook.settings
                                .removeModel({ modelId: model.id })
                                .then(load)
                                .catch(onError)
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {section === 'storage' && (
            <section className="settings-section">
              <h2>Library &amp; Storage</h2>
              {storage && (
                <>
                  <div className="settings-card">
                    <h3>Active library</h3>
                    <code>{storage.libraryPath}</code>
                    <div className="storage-grid">
                      <span>
                        Database <strong>{bytes(storage.databaseBytes)}</strong>
                      </span>
                      <span>
                        Assets <strong>{bytes(storage.assetsBytes)}</strong>
                      </span>
                      <span>
                        Models <strong>{bytes(storage.modelsBytes)}</strong>
                      </span>
                    </div>
                  </div>
                  <div className="settings-card">
                    <h3>Move library</h3>
                    <p>
                      Copies a verified snapshot of your database, assets, configuration, and models. The original is
                      retained until you remove it after restart.
                    </p>
                    {storage.migration.state === 'pending-restart' ? (
                      <p className="diagnostic-result">
                        Move verified. Restart the application to activate the new library.
                      </p>
                    ) : (
                      <Button
                        onClick={() => void window.researchNotebook.settings.moveLibrary().then(load).catch(onError)}
                      >
                        Move library…
                      </Button>
                    )}
                    {storage.oldLibraryPath && (
                      <div className="old-library">
                        <code>Original retained at {storage.oldLibraryPath}</code>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            if (window.confirm('Permanently remove the original library? This cannot be undone.'))
                              void window.researchNotebook.settings.removeOldLibrary().then(load).catch(onError)
                          }}
                        >
                          Remove original
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          )}
          {section === 'maintenance' && (
            <section className="settings-section">
              <h2>Maintenance</h2>
              <p className="dialog-copy">
                Backups, integrity checks, diagnostics, and background-job history stay local to this library.
              </p>
              {maintenance && <p className="diagnostic-result">{maintenance}</p>}
              <div className="dialog-actions">
                <Button
                  variant="secondary"
                  onClick={() => void window.researchNotebook.backups.start().then(load).catch(onError)}
                >
                  Back up library
                </Button>
                <Button variant="secondary" disabled={!notebookId} onClick={() => void scan()}>
                  Scan active notebook assets
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    void window.researchNotebook.diagnostics
                      .export()
                      .then((path) => setMaintenance(path ? `Exported to ${path}` : 'No diagnostics exported.'))
                      .catch(onError)
                  }
                >
                  Export diagnostics
                </Button>
              </div>
              <div className="jobs-list settings-jobs">
                {jobs.length ? (
                  jobs.map((job) => (
                    <div className="job-row" key={job.id}>
                      <div>
                        <strong>{job.kind}</strong>
                        <small>
                          {job.status}
                          {job.status === 'running' ? ` · ${job.progress}%` : ''}
                          {job.errorMessage ? ` · ${job.errorMessage}` : ''}
                        </small>
                      </div>
                      {['queued', 'running'].includes(job.status) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void window.researchNotebook.jobs.cancel({ jobId: job.id }).then(load).catch(onError)
                          }
                        >
                          Cancel
                        </Button>
                      )}
                      {['failed', 'cancelled'].includes(job.status) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void window.researchNotebook.jobs.retry({ jobId: job.id }).then(load).catch(onError)
                          }
                        >
                          Retry
                        </Button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="dialog-copy">No background jobs.</p>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </section>
  )
}
function JobsDialog({
  onOpenChange,
  onError
}: {
  onOpenChange: (open: boolean) => void
  onError: (error: unknown) => void
}): ReactElement {
  const [jobs, setJobs] = useState<Job[]>([])
  const load = useCallback(async () => setJobs(await window.researchNotebook.jobs.list()), [])
  useEffect(() => {
    void load().catch(onError)
    const timer = window.setInterval(() => void load().catch(onError), 1200)
    return () => window.clearInterval(timer)
  }, [load, onError])
  return (
    <Modal title="Jobs" open onOpenChange={onOpenChange}>
      <div className="jobs-list">
        {jobs.length ? (
          jobs.map((job) => (
            <div className="job-row" key={job.id}>
              <div>
                <strong>{job.kind}</strong>
                <small>
                  {job.status}
                  {job.status === 'running' ? ` · ${job.progress}%` : ''}
                </small>
                {job.errorMessage && <small className="danger-text">{job.errorMessage}</small>}
              </div>
              {(job.status === 'queued' || job.status === 'running') && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void window.researchNotebook.jobs.cancel({ jobId: job.id }).then(load).catch(onError)}
                >
                  Cancel
                </Button>
              )}
              {(job.status === 'failed' || job.status === 'cancelled') && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void window.researchNotebook.jobs.retry({ jobId: job.id }).then(load).catch(onError)}
                >
                  Retry
                </Button>
              )}
            </div>
          ))
        ) : (
          <p className="dialog-copy">No background jobs.</p>
        )}
      </div>
    </Modal>
  )
}
function DiagnosticsDialog({
  notebookId,
  onOpenChange,
  onError
}: {
  notebookId: string | null
  onOpenChange: (open: boolean) => void
  onError: (error: unknown) => void
}): ReactElement {
  const [result, setResult] = useState('')
  const [events, setEvents] = useState<ErrorEvent[]>([])
  const [process, setProcess] = useState<ErrorProcess | ''>('')
  const [severity, setSeverity] = useState<ErrorSeverity | ''>('')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState<ErrorEvent | null>(null)
  const load = useCallback(
    async () =>
      setEvents(
        await window.researchNotebook.diagnostics.listErrors({
          ...(process ? { process } : {}),
          ...(severity ? { severity } : {}),
          ...(category.trim() ? { category: category.trim() } : {})
        })
      ),
    [process, severity, category]
  )
  useEffect(() => {
    void load().catch(onError)
  }, [load, onError])
  const inspect = async (id: string) => {
    try {
      setSelected(await window.researchNotebook.diagnostics.getError({ id }))
    } catch (error) {
      onError(error)
    }
  }
  return (
    <Modal title="Diagnostics" open onOpenChange={onOpenChange}>
      <p className="dialog-copy">Local error records include full debugging detail and are never sent anywhere.</p>
      {result && <p className="diagnostic-result">{result}</p>}
      <div className="dialog-actions">
        <Button
          variant="secondary"
          disabled={!notebookId}
          onClick={() =>
            void (async () => {
              if (!notebookId) return
              const report = await window.researchNotebook.assets.diagnostics({ notebookId })
              setResult(
                `${report.missing.length} missing · ${report.orphaned.length} unreferenced · ${report.untrackedFiles.length} untracked`
              )
            })().catch(onError)
          }
        >
          Scan assets
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            void window.researchNotebook.diagnostics
              .export()
              .then((path) => setResult(path ? `Exported to ${path}` : 'No diagnostics to export.'))
              .catch(onError)
          }
        >
          Export diagnostics
        </Button>
      </div>
      <div>
        <select
          aria-label="Filter errors by process"
          value={process}
          onChange={(event) => setProcess(event.target.value as ErrorProcess | '')}
        >
          <option value="">All processes</option>
          {(['renderer', 'preload', 'main', 'service', 'job', 'lifecycle'] as const).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter errors by severity"
          value={severity}
          onChange={(event) => setSeverity(event.target.value as ErrorSeverity | '')}
        >
          <option value="">All severities</option>
          {(['warning', 'error', 'fatal'] as const).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Input
          aria-label="Filter errors by category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="Category"
        />
      </div>
      <div>
        {events.length ? (
          events.map((event) => (
            <details key={event.id}>
              <summary>
                {new Date(event.createdAt).toLocaleString()} · {event.process} · {event.severity} · {event.message}
              </summary>
              <Button variant="secondary" size="sm" onClick={() => void inspect(event.id)}>
                Show full detail
              </Button>
              {selected?.id === event.id && <pre>{JSON.stringify(selected, null, 2)}</pre>}
            </details>
          ))
        ) : (
          <p className="dialog-copy">No matching saved errors.</p>
        )}
      </div>
    </Modal>
  )
}
function ExportDialog({
  notebookId,
  workspace,
  activeNoteId,
  onOpenChange,
  onError
}: {
  notebookId: string | null
  workspace: PageWorkspace | null
  activeNoteId: string | null
  onOpenChange: (open: boolean) => void
  onError: (error: unknown) => void
}): ReactElement {
  const [scope, setScope] = useState<'notebook' | 'page' | 'note'>('page')
  const start = async (format: 'markdown' | 'lossless-json' | 'ai-context' | 'pdf') => {
    if (!notebookId) return
    try {
      await window.researchNotebook.exports.start({
        scope:
          scope === 'note' && activeNoteId
            ? { type: 'note', noteId: activeNoteId }
            : scope === 'page' && workspace
              ? { type: 'page', pageId: workspace.id }
              : { type: 'notebook', notebookId },
        format
      })
      onOpenChange(false)
    } catch (error) {
      onError(error)
    }
  }
  return (
    <Modal title="Export" open onOpenChange={onOpenChange}>
      <label className="field-label">
        Scope
        <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
          <option value="notebook">Notebook</option>
          <option value="page" disabled={!workspace}>
            Current page
          </option>
          <option value="note" disabled={!activeNoteId}>
            Active note
          </option>
        </select>
      </label>
      <div className="export-options">
        {(['markdown', 'pdf', 'lossless-json', 'ai-context'] as const).map((format) => (
          <Button key={format} variant="secondary" disabled={!notebookId} onClick={() => void start(format)}>
            {format.replace('-', ' ')}
          </Button>
        ))}
      </div>
    </Modal>
  )
}
function TrashDialog({
  records,
  onOpenChange,
  onChanged,
  onError
}: {
  records: TrashRecord[]
  onOpenChange: (open: boolean) => void
  onChanged: () => Promise<void>
  onError: (error: unknown) => void
}): ReactElement {
  return (
    <Modal title="Trash" open onOpenChange={onOpenChange}>
      <p className="dialog-copy">Restore items or permanently delete them.</p>
      <div className="trash-list">
        {records.length ? (
          records.map((record) => (
            <div className="trash-row" key={`${record.entityType}-${record.id}`}>
              <div>
                <strong>{record.title}</strong>
                <small>
                  {record.entityType} · deleted {new Date(record.deletedAt).toLocaleDateString()}
                </small>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void window.researchNotebook.trash
                    .restore({
                      entityType: record.entityType,
                      id: record.id,
                      deletionOperationId: record.deletionOperationId
                    })
                    .then(onChanged)
                    .catch(onError)
                }
              >
                Restore
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() =>
                  void window.researchNotebook.trash
                    .permanentlyDelete({ entityType: record.entityType, id: record.id })
                    .then(onChanged)
                    .catch(onError)
                }
              >
                Delete
              </Button>
            </div>
          ))
        ) : (
          <p className="dialog-copy">Trash is empty.</p>
        )}
      </div>
    </Modal>
  )
}
function Empty({ onNewNotebook }: { onNewNotebook: () => Promise<void> }): ReactElement {
  return (
    <div className="empty-state app-empty">
      <BookOpen size={34} />
      <h1>Your structured research workspace</h1>
      <p>Create a notebook, then add pages, notes, and blocks.</p>
      <Button onClick={() => void onNewNotebook()}>Create notebook</Button>
    </div>
  )
}
