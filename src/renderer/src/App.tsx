import React, { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import {
  BookOpen,
  ChevronDown,
  FilePlus2,
  FolderPlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Trash2
} from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type {
  BlockSource,
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
import { bytes } from './format-bytes'
import { SaveContext, SaveCoordinator, useSaves } from './save-coordinator'
import { AudioRecorder, PageWorkspace as EditorWorkspace } from './features/editor/PageWorkspace'
import { SourceWorkspace } from './features/sources/SourceWorkspace'

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'The requested change could not be saved.'
type Utility = 'settings' | 'diagnostics' | 'export' | 'jobs' | 'trash' | null
const applyAppearance = (preferences: AppPreferences) => {
  document.documentElement.dataset.theme = preferences.theme
  document.documentElement.dataset.density = preferences.density
}

export function App(): ReactElement {
  const [saves] = useState(() => new SaveCoordinator())
  const [sourceNavigation, setSourceNavigation] = useState<BlockSource | null>(null)
  const workspaceRef = useRef<PageWorkspace | null>(null)
  const pageRef = useRef<string | null>(null)
  const request = useRef(0)
  const [migration, setMigration] = useState('idle')
  const [searchState, setSearchState] = useState('initial')
  const searchRequest = useRef(0)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const handleError = useCallback((value: unknown) => setError(errorMessage(value)), [])
  const activeNoteRef = useRef<string | null>(null)
  useEffect(() => {
    activeNoteRef.current = activeNoteId
  }, [activeNoteId])
  const searchInput = useRef<HTMLInputElement>(null)
  const refreshTree = useCallback(async () => setNotebooks(await window.researchNotebook.notebooks.list()), [])
  const refreshTrash = useCallback(async () => setTrash(await window.researchNotebook.trash.list()), [])
  const openPage = useCallback(
    async (pageId: string, cursor?: string) => {
      await saves.flush()
      const token = ++request.current
      let next: PageWorkspace
      try {
        next = await window.researchNotebook.pages.getWorkspace({ pageId, cursor })
      } catch (error) {
        if (token !== request.current) return
        throw error
      }
      if (token !== request.current) return
      pageRef.current = pageId
      workspaceRef.current = next
      setSelectedPageId(pageId)
      activeNoteRef.current = next.notes[0]?.id ?? null
      setActiveNoteId(activeNoteRef.current)
      setWorkspace(next)
      setError(null)
    },
    [saves]
  )
  const reloadWorkspace = useCallback(async (activateId?: string) => {
    const pageId = pageRef.current
    if (!pageId) return
    const token = ++request.current
    const previous = workspaceRef.current
    const obsolete = () => token !== request.current || pageRef.current !== pageId
    const read = async (cursor?: string) => {
      try {
        return await window.researchNotebook.pages.getWorkspace({ pageId, cursor })
      } catch (error) {
        if (obsolete()) return null
        throw error
      }
    }
    let next = await read()
    if (!next || obsolete()) return
    const notes = [...next.notes]
    const target = activateId ?? activeNoteRef.current
    const loadedTail = () =>
      Math.max(previous?.notes.at(-1)?.position ?? -1, workspaceRef.current?.notes.at(-1)?.position ?? -1)
    while (
      next.nextCursor &&
      ((notes.at(-1)?.position ?? -1) < loadedTail() || (target && !notes.some((n) => n.id === target)))
    ) {
      next = await read(next.nextCursor)
      if (!next || obsolete()) return
      notes.push(...next.notes)
    }
    if (obsolete()) return
    const selected = activateId ?? activeNoteRef.current
    const previousPosition = previous?.notes.find((n) => n.id === selected)?.position ?? 0
    const nextSelection = notes.some((n) => n.id === selected)
      ? selected
      : (notes.find((n) => n.position >= previousPosition)?.id ?? notes.at(-1)?.id ?? null)
    const merged = { ...next, notes }
    workspaceRef.current = merged
    setWorkspace(merged)
    activeNoteRef.current = nextSelection
    setActiveNoteId(nextSelection)
  }, [])
  const trashChanged = useCallback(async () => {
    const tree = await window.researchNotebook.notebooks.list()
    setNotebooks(tree)
    await refreshTrash()
    if (selectedPageId && !tree.some((n) => n.pages.some((p) => p.id === selectedPageId))) {
      ++request.current
      pageRef.current = null
      workspaceRef.current = null
      setSelectedPageId(null)
      setWorkspace(null)
      activeNoteRef.current = null
      setActiveNoteId(null)
      return
    }
    if (selectedPageId) await reloadWorkspace()
  }, [refreshTrash, reloadWorkspace, selectedPageId])
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
        void saves
          .flushEditors()
          .then(() => window.researchNotebook.notes.create({ pageId: workspace.id, title: 'Untitled note' }))
          .then((note) => reloadWorkspace(note.id))
          .catch((error: unknown) => setError(errorMessage(error)))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [workspace, reloadWorkspace, saves])
  const search = async (value = query) => {
    const token = ++searchRequest.current
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setSearchState(value.trim() ? 'searching' : 'initial')
    setResults([])
    if (!value.trim()) return
    searchTimer.current = setTimeout(() => {
      void window.researchNotebook
        .search({ query: value })
        .then((next) => {
          if (token !== searchRequest.current) return
          setResults(next)
          setSearchState(next.length ? 'matches' : 'empty')
        })
        .catch(() => {
          if (token === searchRequest.current) setSearchState('error')
        })
    }, 150)
  }
  const transition = (action: () => void) => {
    void saves
      .flush()
      .then(action)
      .catch((value) => setError(errorMessage(value)))
  }
  useEffect(() => {
    const api = window.researchNotebook.lifecycle
    if (!api) return
    return api.onCloseRequest(async (requestId) => {
      try {
        await saves.flush()
        api.closeResult({ requestId, saved: true })
      } catch (value) {
        setError(errorMessage(value))
        api.closeResult({ requestId, saved: false })
      }
    })
  }, [saves])
  useEffect(() => {
    let alive = true
    const poll = () =>
      void window.researchNotebook.settings
        .migrationStatus()
        .then((status) => {
          if (alive) setMigration(status.state)
        })
        .catch((value) => {
          if (alive) setError(errorMessage(value))
        })
    poll()
    const timer = ['queued', 'copying'].includes(migration) ? setInterval(poll, 1200) : null
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [migration])
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
    await saves.flush()
    setUtility(kind)
  }
  const noteRenamed = useCallback((id: string, title: string) => {
    const current = workspaceRef.current
    if (!current || !current.notes.some((n) => n.id === id)) return
    const next = { ...current, notes: current.notes.map((n) => (n.id === id ? { ...n, title } : n)) }
    workspaceRef.current = next
    setWorkspace(next)
  }, [])
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
        if (pageRef.current !== workspace.id || workspaceRef.current !== workspace) return
        const merged = { ...next, notes: [...workspace.notes, ...next.notes] }
        workspaceRef.current = merged
        setWorkspace(merged)
      }}
      activeNoteId={activeNoteId}
      setActiveNoteId={(id) => {
        if (id !== activeNoteId)
          void saves
            .flushEditors()
            .then(() => {
              activeNoteRef.current = id
              setActiveNoteId(id)
            })
            .catch(handleError)
      }}
      onError={handleError}
      onChanged={refreshTree}
      onNoteRenamed={noteRenamed}
      onTrashed={trashChanged}
      onViewSource={(source) =>
        transition(() => {
          setSourceNavigation(source)
          setMode('research')
        })
      }
      onUtilities={openUtility}
    />
  )
  return (
    <SaveContext.Provider value={saves}>
      <main className={`app-shell ${mode}-mode ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {migration === 'pending-restart' && (
          <div className="migration-banner" role="status">
            Library move verified. Editing is paused until restart activates the destination.{' '}
            <Button onClick={() => void window.researchNotebook.lifecycle.restart()}>Restart now</Button>
          </div>
        )}
        {(migration === 'copying' || migration === 'queued') && (
          <div className="migration-banner" role="status">
            Moving library. Editing is paused.
          </div>
        )}
        <fieldset className="app-content" disabled={['queued', 'copying', 'pending-restart'].includes(migration)}>
          {!sidebarCollapsed && (
            <NotebookSidebar
              notebooks={notebooks}
              selectedPageId={selectedPageId}
              onOpenPage={openPage}
              onRefresh={refreshTree}
              onError={handleError}
              onTrashed={trashChanged}
              onNewNotebook={createNotebook}
            />
          )}
          <section className="application-main">
            <header className="app-toolbar">
              {sidebarCollapsed ? (
                <IconTip label="Expand sidebar">
                  <Button
                    variant="icon"
                    aria-label="Expand notebook sidebar"
                    onClick={() => setSidebarCollapsed(false)}
                  >
                    <PanelLeftOpen size={18} />
                  </Button>
                </IconTip>
              ) : (
                <IconTip label="Collapse sidebar">
                  <Button
                    variant="icon"
                    aria-label="Collapse notebook sidebar"
                    onClick={() => setSidebarCollapsed(true)}
                  >
                    <PanelLeftClose size={18} />
                  </Button>
                </IconTip>
              )}
              <button className="command-search" onClick={() => setPaletteOpen(true)}>
                <Search size={17} />
                <span>Search pages, notes, and blocks…</span>
                <kbd>{navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K'}</kbd>
              </button>
              <div className="workspace-switcher" aria-label="Workspace mode">
                <button
                  className={mode === 'research' ? 'selected' : ''}
                  aria-pressed={mode === 'research'}
                  onClick={() => transition(() => setMode('research'))}
                >
                  <BookOpen size={15} /> Research
                </button>
                <button
                  className={mode === 'write' ? 'selected' : ''}
                  aria-pressed={mode === 'write'}
                  onClick={() => transition(() => setMode('write'))}
                >
                  Write
                </button>
              </div>
              <AppMenu
                openUtility={openUtility}
                reloadWorkspace={async () => {
                  const tree = await window.researchNotebook.notebooks.list()
                  setNotebooks(tree)
                  return tree
                }}
                beforeImport={() => saves.flush()}
                openPage={openPage}
                onError={handleError}
              />
            </header>
            <AudioRecorder
              noteId={activeNoteId}
              onSaved={reloadWorkspace}
              onError={(value) => setError(errorMessage(value))}
            />
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
                onClose={() => transition(() => setUtility(null))}
                beforeMove={async () => {
                  await saves.flush()
                  const job = await window.researchNotebook.settings.moveLibrary()
                  if (job) setMigration('copying')
                }}
                onError={handleError}
              />
            ) : workspace ? (
              mode === 'research' ? (
                <Group className="research-layout" orientation="horizontal">
                  <Panel id="source" defaultSize="42" minSize="30" maxSize="55">
                    <section className="source-pane">
                      <SourceWorkspace
                        navigation={sourceNavigation}
                        notebookId={notebookId}
                        workspace={workspace}
                        activeNoteId={activeNoteId}
                        onSaved={reloadWorkspace}
                        onError={handleError}
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
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            query={query}
            setQuery={setQuery}
            results={results}
            searchState={searchState}
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
            onError={handleError}
          />
        </fieldset>
      </main>
    </SaveContext.Provider>
  )
}

function AppMenu({
  openUtility,
  reloadWorkspace,
  beforeImport,
  openPage,
  onError
}: {
  openUtility: (kind: Utility) => Promise<void>
  reloadWorkspace: () => Promise<NotebookTree[]>
  openPage: (id: string) => Promise<void>
  beforeImport: () => Promise<void>
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
            onSelect={() =>
              void beforeImport()
                .then(() => window.researchNotebook.imports.start())
                .then(async (result) => {
                  if (!result) return
                  const tree = await reloadWorkspace()
                  const imported = tree.find((n) => n.id === result.notebook.id)
                  if (imported?.pages[0]) await openPage(imported.pages[0].id)
                })
                .catch(onError)
            }
          >
            Import lossless archive…
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
  const saves = useSaves()
  const [newPage, setNewPage] = useState('')
  const [filter, setFilter] = useState('')
  const filtered = notebooks.flatMap((n) => {
    const matches = n.title.toLowerCase().includes(filter.toLowerCase())
    const pages = matches ? n.pages : n.pages.filter((p) => p.title.toLowerCase().includes(filter.toLowerCase()))
    return matches || pages.length ? [{ ...n, pages }] : []
  })
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
        <input
          dir="auto"
          aria-label="Filter notebook and page titles"
          placeholder="Filter notebooks and pages…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <kbd>{navigator.platform.includes('Mac') ? '⌘ K' : 'Ctrl K'}</kbd>
      </div>
      <div className="sidebar-label">
        MY NOTEBOOK <ChevronDown size={14} />
      </div>
      <nav>
        {!filtered.length && <p role="status">No matching notebooks or pages.</p>}
        {filtered.map((notebook) => (
          <section className="notebook-tree" key={notebook.id}>
            <div className="tree-title">
              <FolderPlus size={14} />
              <input
                dir="auto"
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
                  void saves
                    .flush()
                    .then(() => window.researchNotebook.trash.move({ entityType: 'notebook', id: notebook.id }))
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
                <bdi>{page.title}</bdi>
              </button>
            ))}
            <div className="new-page">
              <input
                dir="auto"
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
  searchState,
  onSearch,
  onSelect,
  inputRef
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  setQuery: (query: string) => void
  results: SearchResult[]
  searchState: string
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
            dir="auto"
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              void onSearch(event.target.value)
            }}
            placeholder="Search pages, notes, and blocks…"
          />
        </div>
        {results.length ? (
          <div className="search-results">
            {results.map((result) => (
              <button key={`${result.entityType}-${result.entityId}`} onClick={() => void onSelect(result)}>
                <strong>
                  <bdi>{result.title}</bdi>
                </strong>
                <small>
                  {result.entityType} · <bdi>{result.excerpt || 'Match'}</bdi>
                </small>
              </button>
            ))}
          </div>
        ) : (
          <p className="palette-empty">
            {searchState === 'searching'
              ? 'Searching…'
              : searchState === 'empty'
                ? 'No matches.'
                : searchState === 'error'
                  ? 'Search failed. Edit the query to retry.'
                  : 'Start typing to search pages, notes, and blocks.'}
          </p>
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
function SettingsPage({
  beforeMove,
  notebookId,
  onClose,
  onError
}: {
  beforeMove: () => Promise<void>
  notebookId: string | null
  onClose: () => void
  onError: (error: unknown) => void
}): ReactElement {
  const [section, setSection] = useState<'general' | 'transcription' | 'storage' | 'maintenance'>('general')
  const [preferences, setPreferences] = useState<AppPreferences>({ theme: 'system', density: 'default' })
  const [credentialPersistence, setCredentialPersistence] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [key, setKey] = useState('')
  const [models, setModels] = useState<WhisperModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [storage, setStorage] = useState<StorageSummary | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [maintenance, setMaintenance] = useState('')
  const load = useCallback(async () => {
    if (section === 'general') {
      const prefs = await window.researchNotebook.settings.preferences()
      setPreferences(prefs)
      applyAppearance(prefs)
    } else if (section === 'transcription') {
      const [transcription, modelList] = await Promise.all([
        window.researchNotebook.settings.transcription(),
        window.researchNotebook.settings.models()
      ])
      setConfigured(transcription.openRouterConfigured)
      setCredentialPersistence(Boolean(transcription.credentialPersistenceAvailable))
      setSelectedModel(transcription.selectedLocalModel?.id ?? null)
      setModels(modelList)
    } else if (section === 'storage') setStorage(await window.researchNotebook.settings.storage({ refresh: true }))
    else setJobs(await window.researchNotebook.jobs.list())
  }, [section])
  useEffect(() => {
    void load().catch(onError)
    if (section !== 'transcription' && section !== 'maintenance') return
    const timer = window.setInterval(() => void load().catch(onError), 1100)
    return () => window.clearInterval(timer)
  }, [load, onError, section])
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
        `${report.missing.length} missing · ${report.orphaned.length} unreferenced · ${report.hashMismatched.length} corrupt · ${report.untrackedFiles.length} globally untracked`
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
                    dir="auto"
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
              <p className="dialog-copy">
                {credentialPersistence
                  ? 'Credentials are encrypted with operating-system secure storage.'
                  : 'Secure storage is unavailable. New credentials are kept for this session only.'}
              </p>
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
              <Button variant="secondary" onClick={() => void load().catch(onError)}>
                Refresh storage
              </Button>
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
                      <Button onClick={() => void beforeMove().then(load).catch(onError)}>Move library…</Button>
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
              <HistoryCleanup kind="jobs" onCleaned={load} onError={onError} />
              <HistoryCleanup kind="diagnostics" onCleaned={load} onError={onError} />
              {maintenance && <p className="diagnostic-result">{maintenance}</p>}
              <div className="maintenance-tools">
                <h3>Library tools</h3>
                <p className="dialog-copy">Create a backup, check attachments, or save a diagnostics report.</p>
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
                {!notebookId && (
                  <p className="maintenance-hint">Open a notebook in the workspace to scan its assets.</p>
                )}
              </div>
              <div className="maintenance-history-heading">
                <h3>Background jobs</h3>
                <span>{jobs.length} records</span>
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
                  <div className="maintenance-empty">
                    <strong>No background jobs</strong>
                    <p>Exports, backups, and transcription tasks will appear here.</p>
                  </div>
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
          <div className="maintenance-empty">
            <strong>No background jobs</strong>
            <p>Exports, backups, and transcription tasks will appear here.</p>
          </div>
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
      <HistoryCleanup kind="diagnostics" onCleaned={load} onError={onError} />
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
                `${report.missing.length} missing · ${report.orphaned.length} unreferenced · ${report.hashMismatched.length} corrupt · ${report.untrackedFiles.length} globally untracked`
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
      {!notebookId && <p className="maintenance-hint">Open a notebook in the workspace to scan its assets.</p>}
      <div className="diagnostics-filters">
        <label>
          <span>Process</span>
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
        </label>
        <label>
          <span>Severity</span>
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
        </label>
        <label>
          <span>Category</span>
          <Input
            dir="auto"
            aria-label="Filter errors by category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="Filter by category…"
          />
        </label>
        {(process || severity || category) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setProcess('')
              setSeverity('')
              setCategory('')
            }}
          >
            Reset filters
          </Button>
        )}
      </div>
      <div className="diagnostics-events">
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
          <div className="maintenance-empty">
            <strong>{process || severity || category ? 'No matching saved errors' : 'No saved errors'}</strong>
            <p>
              {process || severity || category
                ? 'Try another filter or reset filters to see all records.'
                : 'Errors recorded by the app will appear here with debugging details.'}
            </p>
          </div>
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
  const [job, setJob] = useState<Job | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    let alive = true
    const timer = window.setInterval(() => {
      void window.researchNotebook.jobs
        .get({ jobId: job.id })
        .then((next) => {
          if (alive) setJob(next)
        })
        .catch((error) => {
          if (alive) onError(error)
        })
    }, 500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [job, onError])
  const [scope, setScope] = useState<'notebook' | 'page' | 'note'>('page')
  const start = async (format: 'markdown' | 'lossless-json' | 'ai-context' | 'pdf') => {
    if (!notebookId) return
    setChoosing(true)
    setMessage('')
    try {
      const next = await window.researchNotebook.exports.start({
        scope:
          scope === 'note' && activeNoteId
            ? { type: 'note', noteId: activeNoteId }
            : scope === 'page' && workspace
              ? { type: 'page', pageId: workspace.id }
              : { type: 'notebook', notebookId },
        format
      })
      setJob(next)
      if (!next) setMessage('Export cancelled.')
    } catch (error) {
      onError(error)
    } finally {
      setChoosing(false)
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
      {choosing && <p role="status">Choose an export folder…</p>}
      {message && <p role="status">{message}</p>}
      {job && (
        <section className="export-progress" aria-label="Export progress">
          <p role="status">
            {job.status === 'completed'
              ? 'Export complete'
              : job.status === 'failed'
                ? 'Export failed'
                : job.status === 'cancelled'
                  ? 'Export cancelled'
                  : `Exporting · ${job.progress}%`}
          </p>
          {['queued', 'running'].includes(job.status) && (
            <>
              <progress max="100" value={job.progress} />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void window.researchNotebook.jobs.cancel({ jobId: job.id }).then(setJob).catch(onError)}
              >
                Cancel export
              </Button>
            </>
          )}
          {job.errorMessage && <p role="alert">{job.errorMessage}</p>}
          {['failed', 'cancelled'].includes(job.status) && (
            <Button
              variant="secondary"
              onClick={() => void window.researchNotebook.jobs.retry({ jobId: job.id }).then(setJob).catch(onError)}
            >
              Retry export
            </Button>
          )}
          {job.status === 'completed' && (
            <Button onClick={() => void window.researchNotebook.exports.openFolder({ jobId: job.id }).catch(onError)}>
              Open export folder
            </Button>
          )}
        </section>
      )}
      <div className="export-options">
        {(['markdown', 'pdf', 'lossless-json', 'ai-context'] as const).map((format) => (
          <Button
            key={format}
            variant="secondary"
            disabled={!notebookId || choosing || Boolean(job && ['queued', 'running'].includes(job.status))}
            onClick={() => void start(format)}
          >
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
  const [pending, setPending] = useState<TrashRecord | null>(null)
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
              <Button variant="danger" size="sm" onClick={() => setPending(record)}>
                Delete
              </Button>
            </div>
          ))
        ) : (
          <p className="dialog-copy">Trash is empty.</p>
        )}
      </div>
      <Modal
        defaultCancel
        title="Permanently delete item?"
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <p>
          Delete “{pending?.title}” ({pending?.entityType}) and all descendants? This cannot be undone.
        </p>
        <div className="dialog-actions">
          <Button data-default-cancel variant="secondary" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (!pending) return
              void window.researchNotebook.trash
                .permanentlyDelete({ entityType: pending.entityType, id: pending.id })
                .then(async () => {
                  setPending(null)
                  await onChanged()
                })
                .catch(onError)
            }}
          >
            Permanently delete
          </Button>
        </div>
      </Modal>
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

function HistoryCleanup({
  kind,
  onCleaned,
  onError
}: {
  kind: 'jobs' | 'diagnostics'
  onCleaned: () => Promise<void>
  onError: (error: unknown) => void
}): ReactElement {
  const [days, setDays] = useState(30)
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const preview = async () => {
    setBusy(true)
    try {
      setCount(await window.researchNotebook.diagnostics.cleanup({ kind, days }))
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }
  const apply = async () => {
    setBusy(true)
    try {
      const removed = await window.researchNotebook.diagnostics.cleanup({ kind, days, apply: true })
      setCount(null)
      setResult(`Removed ${removed} ${kind === 'jobs' ? 'finished jobs' : 'saved diagnostic records'}.`)
      await onCleaned()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="history-cleanup">
      <div className="history-cleanup-heading">
        <strong>{kind === 'jobs' ? 'Finished job history' : 'Saved errors and job diagnostics'}</strong>
        <p>
          {kind === 'jobs'
            ? 'Clear completed, failed, and cancelled jobs. Active jobs stay in your library.'
            : 'Remove local debugging records. Your notes, files, and transcripts stay in your library.'}
        </p>
      </div>
      <div className="history-cleanup-controls">
        <label>
          <span>Remove</span>
          <select
            aria-label={`${kind} cleanup range`}
            value={days === 0 ? 'all' : 'older'}
            onChange={(event) => {
              setDays(event.target.value === 'all' ? 0 : 30)
              setCount(null)
              setResult('')
            }}
          >
            <option value="older">History older than…</option>
            <option value="all">All {kind === 'jobs' ? 'finished history' : 'saved diagnostics'}</option>
          </select>
        </label>
        {days > 0 && (
          <label>
            Older than{' '}
            <input
              dir="auto"
              aria-label={`${kind} retention days`}
              type="number"
              min="1"
              max="36500"
              value={days}
              onChange={(event) => {
                setDays(Math.max(1, Math.min(36500, Number(event.target.value) || 30)))
                setCount(null)
              }}
            />{' '}
            days
          </label>
        )}
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void preview()}>
          {busy ? 'Working…' : 'Preview cleanup'}
        </Button>
      </div>
      {result && <p role="status">{result}</p>}
      {count !== null && (
        <div role="alert">
          <p>
            {count === 0
              ? 'No records match this range. Try a shorter age or choose all history.'
              : `${count} records will be permanently removed. Your saved content and active jobs are preserved.`}
          </p>
          <Button variant="danger" size="sm" disabled={busy || count === 0} onClick={() => void apply()}>
            Confirm cleanup
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCount(null)}>
            Keep history
          </Button>
        </div>
      )}
    </section>
  )
}
