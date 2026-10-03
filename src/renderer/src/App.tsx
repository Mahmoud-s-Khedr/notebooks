import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { textBlockTypes, type AssetKind, type Block, type BlockRelation, type Job, type NotebookTree, type PageWorkspace, type SearchResult, type SourceDocument, type TextBlockType, type TrashEntityType, type TrashRecord } from '../../shared/domain'

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'The requested change could not be saved.' }
const textLabel = (type: string): string => type.replaceAll('_', ' ')

type Command = { id: string; shortcut: string; run: () => void }
function useCommandRegistry(commands: Command[]): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const shortcut = mod && event.shiftKey && event.key.toLowerCase() === 'n' ? 'Mod+Shift+N'
        : mod && event.key === 'Enter' ? 'Mod+Enter'
          : mod && event.key.toLowerCase() === 'k' ? 'Mod+K' : undefined
      const command = commands.find((item) => item.shortcut === shortcut)
      if (command) { event.preventDefault(); command.run() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [commands])
}

export function App(): ReactElement {
  const [notebooks, setNotebooks] = useState<NotebookTree[]>([])
  const [workspace, setWorkspace] = useState<PageWorkspace | null>(null)
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [newNotebookTitle, setNewNotebookTitle] = useState('')
  const [newPageTitle, setNewPageTitle] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [trash, setTrash] = useState<TrashRecord[]>([])
  const [showTrash, setShowTrash] = useState(false)
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  const refreshTree = useCallback(async () => setNotebooks(await window.researchNotebook.notebooks.list()), [])
  const refreshTrash = useCallback(async () => setTrash(await window.researchNotebook.trash.list()), [])
  const openPage = useCallback(async (pageId: string, cursor?: string) => {
    setError(null); setSelectedPageId(pageId); setActiveNoteId(null)
    setWorkspace(await window.researchNotebook.pages.getWorkspace({ pageId, cursor }))
  }, [])
  const reloadWorkspace = useCallback(async () => {
    if (selectedPageId) { setWorkspace(await window.researchNotebook.pages.getWorkspace({ pageId: selectedPageId })); setActiveNoteId(null) }
  }, [selectedPageId])
  const createNoteForCurrentPage = useCallback(async () => {
    if (!workspace) return
    try { const note = await window.researchNotebook.notes.create({ pageId: workspace.id, title: 'Untitled note' }); setActiveNoteId(note.id); await reloadWorkspace() } catch (cause) { setError(errorMessage(cause)) }
  }, [workspace, reloadWorkspace])
  const createTextForActiveNote = useCallback(async () => {
    const noteId = activeNoteId ?? workspace?.notes[0]?.id
    if (!noteId) return
    try { await window.researchNotebook.blocks.create({ noteId, type: 'text', data: { text: '' } }); await reloadWorkspace() } catch (cause) { setError(errorMessage(cause)) }
  }, [activeNoteId, workspace, reloadWorkspace])

  useCommandRegistry([
    { id: 'new-note', shortcut: 'Mod+Shift+N', run: () => { void createNoteForCurrentPage() } },
    { id: 'new-text-block', shortcut: 'Mod+Enter', run: () => { void createTextForActiveNote() } },
    { id: 'focus-search', shortcut: 'Mod+K', run: () => searchInput.current?.focus() }
  ])

  useEffect(() => { refreshTree().catch((cause: unknown) => setError(errorMessage(cause))) }, [refreshTree])
  useEffect(() => {
    if (!scrollTarget || !workspace) return
    requestAnimationFrame(() => document.querySelector(`[data-item-id="${scrollTarget}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    setScrollTarget(null)
  }, [scrollTarget, workspace])

  const createNotebook = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const notebook = await window.researchNotebook.notebooks.create({ title: newNotebookTitle })
      setNewNotebookTitle('')
      const page = await window.researchNotebook.pages.create({ notebookId: notebook.id, title: 'Untitled page' })
      await refreshTree(); await openPage(page.id)
    } catch (cause) { setError(errorMessage(cause)) }
  }
  const createPage = async (notebookId: string) => {
    if (!newPageTitle.trim()) return
    try { const page = await window.researchNotebook.pages.create({ notebookId, title: newPageTitle }); setNewPageTitle(''); await refreshTree(); await openPage(page.id) } catch (cause) { setError(errorMessage(cause)) }
  }
  const runSearch = async () => {
    try { setSearchResults(searchQuery.trim() ? await window.researchNotebook.search({ query: searchQuery }) : []) } catch (cause) { setError(errorMessage(cause)) }
  }
  const selectSearch = async (result: SearchResult) => {
    try {
      if (result.pageId) {
        const cursor = result.notePosition && result.notePosition > 0 ? String(result.notePosition - 1) : undefined
        await openPage(result.pageId, cursor)
        setScrollTarget(result.blockId ?? result.noteId ?? result.pageId)
      }
      else if (result.notebookId) { const notebook = notebooks.find(({ id }) => id === result.notebookId); if (notebook?.pages[0]) await openPage(notebook.pages[0].id) }
      setSearchResults([])
    } catch (cause) { setError(errorMessage(cause)) }
  }
  const loadMore = async () => {
    if (!workspace?.nextCursor) return
    try {
      const next = await window.researchNotebook.pages.getWorkspace({ pageId: workspace.id, cursor: workspace.nextCursor })
      setWorkspace({ ...next, notes: [...workspace.notes, ...next.notes] })
    } catch (cause) { setError(errorMessage(cause)) }
  }
  const showTrashPanel = async () => { try { await refreshTrash(); setShowTrash(true) } catch (cause) { setError(errorMessage(cause)) } }
  const afterTrashChange = async () => { await Promise.all([refreshTree(), refreshTrash()]); if (selectedPageId) { try { await reloadWorkspace() } catch { setWorkspace(null); setSelectedPageId(null) } } }
  const activeNotebookId = selectedPageId ? notebooks.find((notebook) => notebook.pages.some(({ id }) => id === selectedPageId))?.id ?? null : null

  return <main className="app-shell">
    <aside className="sidebar" aria-label="Notebooks">
      <div className="product-name">Research Notebook</div>
      <button className="trash-open" onClick={showTrashPanel}>Trash</button>
      <JobsPanel onError={(cause) => setError(errorMessage(cause))} />
      <form className="inline-form" onSubmit={createNotebook}>
        <input aria-label="New notebook title" value={newNotebookTitle} onChange={(event) => setNewNotebookTitle(event.target.value)} placeholder="New notebook" />
        <button type="submit">Add</button>
      </form>
      <nav>
        {notebooks.map((notebook) => <NotebookNavigation key={notebook.id} notebook={notebook} selectedPageId={selectedPageId} newPageTitle={newPageTitle} setNewPageTitle={setNewPageTitle} onOpenPage={openPage} onCreatePage={createPage} onChanged={refreshTree} onError={(cause) => setError(errorMessage(cause))} onTrashed={afterTrashChange} />)}
      </nav>
    </aside>
    <section className="source-pane" aria-label="Source viewer">
      <SourcePane notebookId={activeNotebookId} workspace={workspace} activeNoteId={activeNoteId} onSaved={reloadWorkspace} onError={(cause) => setError(errorMessage(cause))} />
      <div className="search-panel"><label htmlFor="global-search">Search <kbd>⌘/Ctrl K</kbd></label><div className="inline-form"><input ref={searchInput} id="global-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void runSearch() } }} placeholder="Search local notes" /><button onClick={() => void runSearch()}>Find</button></div>
        {searchResults.length > 0 && <div className="search-results">{searchResults.map((result) => <button key={`${result.entityType}-${result.entityId}`} onClick={() => void selectSearch(result)}><strong>{result.title}</strong><small>{result.entityType} · {result.excerpt || 'Match'}</small></button>)}</div>}
      </div>
    </section>
    <section className="workspace">
      {error && <div className="error" role="alert">{error}<button onClick={() => setError(null)}>Dismiss</button></div>}
      {workspace ? <PageEditor workspace={workspace} reloadWorkspace={reloadWorkspace} loadMore={loadMore} activeNoteId={activeNoteId} setActiveNoteId={setActiveNoteId} onError={(cause) => setError(errorMessage(cause))} onChanged={refreshTree} onTrashed={afterTrashChange} /> : <div className="empty-state"><h1>Your structured research workspace</h1><p>Create a notebook, then add pages, notes, and blocks.</p></div>}
    </section>
    {showTrash && <TrashPanel records={trash} onClose={() => setShowTrash(false)} onChanged={afterTrashChange} onError={(cause) => setError(errorMessage(cause))} />}
  </main>
}

function SourcePane({ notebookId, workspace, activeNoteId, onSaved, onError }: { notebookId: string | null; workspace: PageWorkspace | null; activeNoteId: string | null; onSaved: () => Promise<void>; onError: (error: unknown) => void }): ReactElement {
  const [sources, setSources] = useState<SourceDocument[]>([]); const [source, setSource] = useState<SourceDocument | null>(null); const [url, setUrl] = useState('')
  const [page, setPage] = useState(1); const [printedPage, setPrintedPage] = useState(''); const [selection, setSelection] = useState(''); const [diagnostics, setDiagnostics] = useState('')
  const [openRouterKey, setOpenRouterKey] = useState(''); const [openRouterConfigured, setOpenRouterConfigured] = useState(false); const [exportScope, setExportScope] = useState<'notebook' | 'page' | 'note'>('notebook')
  const refresh = useCallback(async () => { if (!notebookId) { setSources([]); setSource(null); return }; const next = await window.researchNotebook.sources.list({ notebookId }); setSources(next); if (!source || !next.some(({ id }) => id === source.id)) setSource(next[0] ?? null) }, [notebookId, source])
  useEffect(() => { void refresh().catch(onError) }, [refresh, onError])
  useEffect(() => { window.researchNotebook.settings.transcription().then((settings) => setOpenRouterConfigured(settings.openRouterConfigured)).catch(onError) }, [onError])
  useEffect(() => { if (!source) { setUrl(''); return }; window.researchNotebook.assets.dataUrl({ assetId: source.assetId }).then(setUrl).catch(onError) }, [source, onError])
  useEffect(() => { const open = (event: Event) => { const detail = (event as CustomEvent<{ sourceDocumentId: string; pdfPage: number | null }>).detail; const next = sources.find(({ id }) => id === detail.sourceDocumentId); if (next) { setSource(next); setPage(detail.pdfPage ?? 1) } }; window.addEventListener('research-notebook:open-source', open); return () => window.removeEventListener('research-notebook:open-source', open) }, [sources])
  const noteId = activeNoteId ?? workspace?.notes[0]?.id
  const importPdf = async () => { if (!notebookId) return; try { await window.researchNotebook.sources.importPdf({ notebookId }); await refresh() } catch (cause) { onError(cause) } }
  const capture = async () => { if (!noteId || !source) return; try { await window.researchNotebook.sources.captureText({ noteId, sourceDocumentId: source.id, pdfPage: page, printedPage: printedPage ? Number(printedPage) : undefined, text: selection }); setSelection(''); await onSaved() } catch (cause) { onError(cause) } }
  const qa = async () => { if (!workspace || !source || !selection.trim()) return; try { await window.researchNotebook.sources.createQaNote({ pageId: workspace.id, sourceDocumentId: source.id, pdfPage: page, printedPage: printedPage ? Number(printedPage) : undefined, text: selection }); setSelection(''); await onSaved() } catch (cause) { onError(cause) } }
  const importAndAttach = async (kind: AssetKind) => { if (!notebookId || !noteId) return; try { const asset = await window.researchNotebook.assets.import({ notebookId, kind }); if (asset) await window.researchNotebook.assets.attach({ noteId, assetId: asset.id, type: kind }); await onSaved() } catch (cause) { onError(cause) } }
  const inspect = async () => { if (!notebookId) return; try { const result = await window.researchNotebook.assets.diagnostics({ notebookId }); setDiagnostics(`${result.missing.length} missing · ${result.orphaned.length} unreferenced · ${result.untrackedFiles.length} untracked`) } catch (cause) { onError(cause) } }
  const exportNotebook = async (format: 'markdown' | 'lossless-json' | 'ai-context' | 'pdf') => { if (!notebookId) return; try { const scope = exportScope === 'page' && workspace ? { type: 'page' as const, pageId: workspace.id } : exportScope === 'note' && noteId ? { type: 'note' as const, noteId } : { type: 'notebook' as const, notebookId }; await window.researchNotebook.exports.start({ scope, format }) } catch (cause) { onError(cause) } }
  const importBackup = async () => { try { await window.researchNotebook.imports.start(); await onSaved() } catch (cause) { onError(cause) } }
  const saveOpenRouterKey = async () => { try { await window.researchNotebook.settings.setOpenRouterKey({ key: openRouterKey }); setOpenRouterKey(''); setOpenRouterConfigured(true) } catch (cause) { onError(cause) } }
  return <><h2>Source Viewer</h2><p>Local PDFs keep their provenance when you capture a selection.</p>
    <div className="source-actions"><button onClick={() => void importBackup()}>Import backup</button><button onClick={() => void window.researchNotebook.backups.start().catch(onError)}>Back up library</button><button disabled={!notebookId} onClick={() => void importPdf()}>Import PDF</button><button disabled={!notebookId || !noteId} onClick={() => void importAndAttach('image')}>Add image</button><button disabled={!notebookId || !noteId} onClick={() => void importAndAttach('screenshot')}>Add screenshot</button><button disabled={!notebookId || !noteId} onClick={() => void importAndAttach('audio')}>Add audio</button><button disabled={!notebookId || !noteId} onClick={() => void importAndAttach('file')}>Add file</button><button disabled={!notebookId} onClick={() => void inspect()}>Check assets</button><select aria-label="Export scope" value={exportScope} onChange={(event) => setExportScope(event.target.value as typeof exportScope)}><option value="notebook">Notebook</option><option value="page" disabled={!workspace}>Current page</option><option value="note" disabled={!noteId}>Current note</option></select><button disabled={!notebookId} onClick={() => void exportNotebook('lossless-json')}>Backup</button><button disabled={!notebookId} onClick={() => void exportNotebook('markdown')}>Export Markdown</button><button disabled={!notebookId} onClick={() => void exportNotebook('pdf')}>Export PDF</button><button disabled={!notebookId} onClick={() => void exportNotebook('ai-context')}>Export AI context</button></div>
    {diagnostics && <small className="diagnostics">Assets: {diagnostics}</small>}
    <div className="key-settings"><small>OpenRouter: {openRouterConfigured ? 'key configured' : 'not configured'}</small><input type="password" aria-label="OpenRouter API key" value={openRouterKey} onChange={(event) => setOpenRouterKey(event.target.value)} placeholder="OpenRouter key" /><button disabled={!openRouterKey.trim()} onClick={() => void saveOpenRouterKey()}>Save key</button></div>
    {sources.length > 0 && <select className="source-select" aria-label="Source document" value={source?.id ?? ''} onChange={(event) => setSource(sources.find(({ id }) => id === event.target.value) ?? null)}>{sources.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}
    {url && <iframe className="pdf-viewer" title={source?.title ?? 'PDF source'} src={`${url}#page=${page}`} />}
    {source && <div className="capture-panel"><div><label>PDF page <input type="number" min="1" value={page} onChange={(event) => setPage(Math.max(1, Number(event.target.value)))} /></label><label>Printed page <input type="number" min="1" value={printedPage} onChange={(event) => setPrintedPage(event.target.value)} /></label></div><textarea aria-label="Selected PDF text" value={selection} onChange={(event) => setSelection(event.target.value)} placeholder="Paste or type the selected PDF text…" /><div className="source-actions"><button disabled={!noteId || !selection.trim()} onClick={() => void capture()}>Capture source text</button><button disabled={!selection.trim()} onClick={() => void qa()}>Create Q&A Note</button></div></div>}
  </>
}

function JobsPanel({ onError }: { onError: (error: unknown) => void }): ReactElement {
  const [jobs, setJobs] = useState<Job[]>([])
  const refresh = useCallback(async () => setJobs(await window.researchNotebook.jobs.list()), [])
  useEffect(() => { void refresh().catch(onError); const timer = window.setInterval(() => void refresh().catch(onError), 1200); return () => window.clearInterval(timer) }, [refresh, onError])
  const active = jobs.filter((item) => item.status === 'queued' || item.status === 'running')
  if (!jobs.length) return <section className="jobs-panel"><small>Jobs: none</small></section>
  return <section className="jobs-panel" aria-label="Jobs"><small>Jobs {active.length ? `(${active.length} active)` : ''}</small>{jobs.slice(0, 5).map((item) => <div key={item.id}><span>{item.kind} · {item.status} {item.status === 'running' ? `${item.progress}%` : ''}</span>{item.errorMessage && <small className="asset-missing">{item.errorMessage}</small>}{(item.status === 'queued' || item.status === 'running') && <button onClick={() => void window.researchNotebook.jobs.cancel({ jobId: item.id }).then(refresh).catch(onError)}>Cancel</button>}{(item.status === 'failed' || item.status === 'cancelled') && <button onClick={() => void window.researchNotebook.jobs.retry({ jobId: item.id }).then(refresh).catch(onError)}>Retry</button>}</div>)}</section>
}

function NotebookNavigation({ notebook, selectedPageId, newPageTitle, setNewPageTitle, onOpenPage, onCreatePage, onChanged, onError, onTrashed }: { notebook: NotebookTree; selectedPageId: string | null; newPageTitle: string; setNewPageTitle: (value: string) => void; onOpenPage: (id: string) => Promise<void>; onCreatePage: (id: string) => Promise<void>; onChanged: () => Promise<void>; onError: (error: unknown) => void; onTrashed: () => Promise<void> }): ReactElement {
  const [title, setTitle] = useState(notebook.title)
  useEffect(() => setTitle(notebook.title), [notebook.id, notebook.title])
  const save = async () => { if (title.trim() && title !== notebook.title) try { await window.researchNotebook.notebooks.update({ notebookId: notebook.id, title }); await onChanged() } catch (cause) { onError(cause) } }
  const remove = async () => { if (window.confirm(`Move “${notebook.title}” and its active contents to Trash?`)) try { await window.researchNotebook.trash.move({ entityType: 'notebook', id: notebook.id }); await onTrashed() } catch (cause) { onError(cause) } }
  return <section className="notebook-tree"><div className="tree-title"><input aria-label="Notebook title" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => void save()} /><button aria-label="Move notebook to trash" onClick={() => void remove()}>⌫</button></div>
    {notebook.pages.map((page) => <button key={page.id} className={`page-link ${page.id === selectedPageId ? 'active' : ''}`} onClick={() => onOpenPage(page.id).catch(onError)}>{page.title}</button>)}
    <div className="inline-form page-form"><input aria-label={`New page for ${notebook.title}`} value={newPageTitle} onChange={(event) => setNewPageTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void onCreatePage(notebook.id) } }} placeholder="New page" /><button onClick={() => void onCreatePage(notebook.id)}>+</button></div>
  </section>
}

function PageEditor({ workspace, reloadWorkspace, loadMore, activeNoteId, setActiveNoteId, onError, onChanged, onTrashed }: { workspace: PageWorkspace; reloadWorkspace: () => Promise<void>; loadMore: () => Promise<void>; activeNoteId: string | null; setActiveNoteId: (id: string | null) => void; onError: (error: unknown) => void; onChanged: () => Promise<void>; onTrashed: () => Promise<void> }): ReactElement {
  const [title, setTitle] = useState(workspace.title)
  useEffect(() => setTitle(workspace.title), [workspace.id, workspace.title])
  const createNote = async () => { try { const note = await window.researchNotebook.notes.create({ pageId: workspace.id, title: 'Untitled note' }); setActiveNoteId(note.id); await reloadWorkspace() } catch (cause) { onError(cause) } }
  const saveTitle = async () => { if (title.trim() && title !== workspace.title) try { await window.researchNotebook.pages.update({ pageId: workspace.id, title }); await Promise.all([reloadWorkspace(), onChanged()]) } catch (cause) { onError(cause) } }
  const remove = async () => { if (window.confirm(`Move page “${workspace.title}” to Trash?`)) try { await window.researchNotebook.trash.move({ entityType: 'page', id: workspace.id }); await onTrashed() } catch (cause) { onError(cause) } }
  const allBlocks = workspace.notes.flatMap((note) => note.blocks)
  return <><header className="page-header" data-item-id={workspace.id}><div><p>Page</p><input className="page-title" aria-label="Page title" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()} /></div><button onClick={() => void createNote()}>New note <kbd>⌘/Ctrl ⇧N</kbd></button><button aria-label="Move page to trash" onClick={() => void remove()}>Trash</button></header>
    <div className="notes">{workspace.notes.map((note) => <NoteEditor key={note.id} note={note} allBlocks={allBlocks} active={activeNoteId === note.id} setActive={() => setActiveNoteId(note.id)} reloadWorkspace={reloadWorkspace} onError={onError} onTrashed={onTrashed} />)}</div>
    {workspace.nextCursor && <button className="load-more" onClick={() => void loadMore()}>Load more notes</button>}
    {workspace.notes.length === 0 && <div className="empty-state"><p>No notes yet.</p><button onClick={() => void createNote()}>Create first note</button></div>}
  </>
}

function NoteEditor({ note, allBlocks, active, setActive, reloadWorkspace, onError, onTrashed }: { note: PageWorkspace['notes'][number]; allBlocks: Block[]; active: boolean; setActive: () => void; reloadWorkspace: () => Promise<void>; onError: (error: unknown) => void; onTrashed: () => Promise<void> }): ReactElement {
  const [title, setTitle] = useState(note.title)
  useEffect(() => setTitle(note.title), [note.id, note.title])
  const saveTitle = async () => { if (title.trim() && title !== note.title) try { await window.researchNotebook.notes.update({ noteId: note.id, title }); await reloadWorkspace() } catch (cause) { onError(cause) } }
  const createBlock = async (type: TextBlockType = 'text') => { try { await window.researchNotebook.blocks.create({ noteId: note.id, type, data: { text: '' } }); await reloadWorkspace() } catch (cause) { onError(cause) } }
  const moveBlock = async (block: Block, direction: -1 | 1) => { const from = note.blocks.findIndex(({ id }) => id === block.id); const to = from + direction; if (to < 0 || to >= note.blocks.length) return; const ids = note.blocks.map(({ id }) => id); [ids[from], ids[to]] = [ids[to], ids[from]]; try { await window.researchNotebook.blocks.reorder({ noteId: note.id, blockIds: ids }); await reloadWorkspace() } catch (cause) { onError(cause) } }
  const duplicate = async () => { try { await window.researchNotebook.notes.duplicate({ noteId: note.id }); await reloadWorkspace() } catch (cause) { onError(cause) } }
  const remove = async () => { if (window.confirm(`Move note “${note.title}” to Trash?`)) try { await window.researchNotebook.trash.move({ entityType: 'note', id: note.id }); await onTrashed() } catch (cause) { onError(cause) } }
  return <article className={`note-card ${active ? 'focused-note' : ''}`} data-item-id={note.id} onFocusCapture={setActive}>
    <div className="note-heading"><input className="note-title" aria-label="Note title" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => void saveTitle()} /><button onClick={() => void duplicate()}>Duplicate</button><button onClick={() => void remove()}>Trash</button></div>
    <div className="blocks">{note.blocks.map((block, index) => <BlockEditor key={block.id} block={block} availableBlocks={allBlocks} onMove={(direction) => void moveBlock(block, direction)} canMoveUp={index > 0} canMoveDown={index < note.blocks.length - 1} onSaved={reloadWorkspace} onError={onError} onTrashed={onTrashed} />)}</div>
    <div className="block-add"><button className="add-block" onClick={() => void createBlock()}>+ Text block <kbd>⌘/Ctrl ↵</kbd></button><AudioRecorder noteId={note.id} onSaved={reloadWorkspace} onError={onError} /><select aria-label="Semantic block type" defaultValue="" onChange={(event) => { const type = event.target.value as TextBlockType; if (type) { void createBlock(type); event.currentTarget.value = '' } }}><option value="">Add semantic block…</option>{textBlockTypes.filter((type) => type !== 'text').map((type) => <option key={type} value={type}>{textLabel(type)}</option>)}</select></div>
  </article>
}

function BlockEditor({ block, availableBlocks, onMove, canMoveUp, canMoveDown, onSaved, onError, onTrashed }: { block: Block; availableBlocks: Block[]; onMove: (direction: -1 | 1) => void; canMoveUp: boolean; canMoveDown: boolean; onSaved: () => Promise<void>; onError: (error: unknown) => void; onTrashed: () => Promise<void> }): ReactElement {
  const [text, setText] = useState(typeof block.data.text === 'string' ? block.data.text : '')
  const [targetId, setTargetId] = useState('')
  const [relationType, setRelationType] = useState<'responds_to' | 'explains' | 'comments_on' | 'summarizes'>('explains')
  const [relations, setRelations] = useState<BlockRelation[]>([])
  const textBased = textBlockTypes.includes(block.type as TextBlockType)
  const loadRelations = useCallback(async () => { try { setRelations(await window.researchNotebook.relations.list({ blockId: block.id })) } catch (cause) { onError(cause) } }, [block.id, onError])
  useEffect(() => { setText(typeof block.data.text === 'string' ? block.data.text : ''); void loadRelations() }, [block.id, block.data.text, loadRelations])
  const save = async () => { if (text !== block.data.text) try { await window.researchNotebook.blocks.update({ blockId: block.id, data: { ...block.data, text } }); await onSaved() } catch (cause) { onError(cause) } }
  const changeType = async (type: TextBlockType) => { try { await window.researchNotebook.blocks.updateType({ blockId: block.id, type }); await onSaved() } catch (cause) { onError(cause) } }
  const duplicate = async () => { try { await window.researchNotebook.blocks.duplicate({ blockId: block.id }); await onSaved() } catch (cause) { onError(cause) } }
  const remove = async () => { if (window.confirm('Move this block to Trash?')) try { await window.researchNotebook.trash.move({ entityType: 'block', id: block.id }); await onTrashed() } catch (cause) { onError(cause) } }
  const link = async () => { if (!targetId) return; try { await window.researchNotebook.relations.create({ fromBlockId: block.id, toBlockId: targetId, relationType }); setTargetId(''); await loadRelations() } catch (cause) { onError(cause) } }
  const unlink = async (id: string) => { try { await window.researchNotebook.relations.remove({ relationId: id }); await loadRelations() } catch (cause) { onError(cause) } }
  const createAnswer = async () => { try { const answer = await window.researchNotebook.blocks.create({ noteId: block.noteId, type: 'answer', data: { text: '' } }); await window.researchNotebook.relations.create({ fromBlockId: answer.id, toBlockId: block.id, relationType: 'responds_to' }); await onSaved() } catch (cause) { onError(cause) } }
  const viewSource = async () => { try { const source = await window.researchNotebook.sources.getBlockSource({ blockId: block.id }); if (source) window.dispatchEvent(new CustomEvent('research-notebook:open-source', { detail: source })) } catch (cause) { onError(cause) } }
  return <div className="block" data-item-id={block.id}>
    <div className="block-toolbar"><select aria-label="Block type" value={block.type} disabled={!textBased} onChange={(event) => void changeType(event.target.value as TextBlockType)}>{textBased ? textBlockTypes.map((type) => <option key={type} value={type}>{textLabel(type)}</option>) : <option>{textLabel(block.type)}</option>}</select><button aria-label="Move block up" disabled={!canMoveUp} onClick={() => onMove(-1)}>↑</button><button aria-label="Move block down" disabled={!canMoveDown} onClick={() => onMove(1)}>↓</button></div>
    <div className="block-content">{textBased ? <textarea aria-label={`${block.type} block`} value={text} onChange={(event) => setText(event.target.value)} onBlur={() => void save()} onKeyDown={(event) => { if (event.altKey && event.key === 'ArrowUp') { event.preventDefault(); onMove(-1) } if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); onMove(1) } }} placeholder="Write your note…" /> : <AssetBlock block={block} onError={onError} />}
      <div className="block-actions"><button onClick={() => void duplicate()}>Duplicate</button>{block.type === 'question' && <button onClick={() => void createAnswer()}>Add answer</button>}{typeof block.data.sourceDocumentId === 'string' && <button onClick={() => void viewSource()}>View source</button>}<button onClick={() => void remove()}>Trash</button></div>
      <div className="relation-controls"><select aria-label="Relation type" value={relationType} onChange={(event) => setRelationType(event.target.value as typeof relationType)}><option value="explains">explains</option><option value="responds_to">responds to</option><option value="comments_on">comments on</option><option value="summarizes">summarizes</option></select><select aria-label="Block to link" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Link to…</option>{availableBlocks.filter(({ id }) => id !== block.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{textLabel(candidate.type)}: {typeof candidate.data.text === 'string' ? candidate.data.text.slice(0, 45) || 'Untitled' : candidate.id.slice(0, 8)}</option>)}</select><button onClick={() => void link()} disabled={!targetId}>Link</button></div>
      {relations.length > 0 && <div className="relations">{relations.map((relation) => <span key={relation.id}>{relation.relationType.replace('_', ' ')} <button aria-label="Remove relation" onClick={() => void unlink(relation.id)}>×</button></span>)}</div>}
    </div>
  </div>
}

function AssetBlock({ block, onError }: { block: Block; onError: (error: unknown) => void }): ReactElement {
  const [url, setUrl] = useState(''); const [near, setNear] = useState(false); const root = useRef<HTMLDivElement>(null); const assetId = typeof block.data.assetId === 'string' ? block.data.assetId : null
  useEffect(() => { const node = root.current; if (!node) return; const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) { setNear(true); observer.disconnect() } }, { rootMargin: '600px' }); observer.observe(node); return () => observer.disconnect() }, [])
  useEffect(() => { if (!assetId || !near) return; let live = true; const load = async () => { try { const thumbnail = (block.type === 'image' || block.type === 'screenshot') ? await window.researchNotebook.assets.thumbnailDataUrl({ assetId, width: 640, height: 480 }) : null; if (thumbnail) { if (live) setUrl(thumbnail); return } if (block.type === 'image' || block.type === 'screenshot') void window.researchNotebook.assets.requestThumbnail({ assetId, width: 640, height: 480 }).catch(onError); const full = await window.researchNotebook.assets.dataUrl({ assetId }); if (live) setUrl(full) } catch (cause) { onError(cause) } }; void load(); return () => { live = false } }, [assetId, near, block.type, onError])
  if (!assetId) return <p className="asset-missing">Missing asset reference.</p>
  if (block.type === 'image' || block.type === 'screenshot') return <div ref={root}>{url ? <img className="asset-image" src={url} alt={typeof block.data.filename === 'string' ? block.data.filename : 'Attached asset'} /> : <p>Loading image…</p>}</div>
  if (block.type === 'audio') return <div ref={root} className="audio-block">{url ? <audio controls src={url}>Audio playback is unavailable.</audio> : <p>Loading recording…</p>}<TranscriptionPanel block={block} onError={onError} /></div>
  return <div ref={root}>{url ? <a className="asset-file" href={url} download={typeof block.data.filename === 'string' ? block.data.filename : undefined}>{typeof block.data.filename === 'string' ? block.data.filename : 'Download attached file'}</a> : <p>Loading file…</p>}</div>
}

function AudioRecorder({ noteId, onSaved, onError }: { noteId: string; onSaved: () => Promise<void>; onError: (error: unknown) => void }): ReactElement {
  const [recording, setRecording] = useState(false)
  const session = useRef<{ stream: MediaStream; context: AudioContext; processor: ScriptProcessorNode; chunks: Float32Array[] } | null>(null)
  const start = async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } }); const context = new AudioContext({ sampleRate: 16000 }); const input = context.createMediaStreamSource(stream); const processor = context.createScriptProcessor(4096, 1, 1); const chunks: Float32Array[] = []; processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0))); input.connect(processor); processor.connect(context.destination); session.current = { stream, context, processor, chunks }; setRecording(true) } catch (cause) { onError(cause instanceof Error ? cause : new Error('Microphone permission is required to record audio.')) } }
  const stop = async () => { const current = session.current; if (!current) return; setRecording(false); current.processor.disconnect(); current.stream.getTracks().forEach((track) => track.stop()); await current.context.close(); const samples = current.chunks.reduce((total, chunk) => total + chunk.length, 0); const wav = new ArrayBuffer(44 + samples * 2); const view = new DataView(wav); const write = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0))); write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); write(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples * 2, true); let offset = 44; current.chunks.forEach((chunk) => chunk.forEach((sample) => { view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 0x7fff, true); offset += 2 })); try { const bytes = new Uint8Array(wav); let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte) }); await window.researchNotebook.assets.saveRecording({ noteId, wavBase64: btoa(binary) }); await onSaved() } catch (cause) { onError(cause) } finally { session.current = null } }
  return <button onClick={() => void (recording ? stop() : start())}>{recording ? 'Stop recording' : 'Record audio'}</button>
}

function TranscriptionPanel({ block, onError }: { block: Block; onError: (error: unknown) => void }): ReactElement {
  const [runs, setRuns] = useState<import('../../shared/domain').TranscriptionRun[]>([]); const [provider, setProvider] = useState<'local' | 'openrouter'>('local'); const [language, setLanguage] = useState(''); const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { try { setRuns(await window.researchNotebook.transcription.list({ blockId: block.id })) } catch (cause) { onError(cause) } }, [block.id, onError])
  useEffect(() => { void load() }, [load]); const active = runs.find((run) => run.id === block.data.activeTranscriptionRunId) ?? runs[0]
  const transcribe = async () => { try { setBusy(true); await window.researchNotebook.transcription.create({ blockId: block.id, provider, language: language || undefined }); await load() } catch (cause) { onError(cause) } finally { setBusy(false) } }
  return <div className="transcription"><div><select aria-label="Transcription provider" value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="local">Local Whisper</option><option value="openrouter">OpenRouter</option></select><input aria-label="Language hint" value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="Language (ar/en)" /><button disabled={busy} onClick={() => void transcribe()}>Transcribe{runs.length ? ' again' : ''}</button></div>{active && <div className={`transcript ${active.status}`}><small>{active.provider} · {active.model} · {active.status}</small>{active.transcriptText && <p>{active.transcriptText}</p>}{active.errorMessage && <p className="asset-missing">{active.errorMessage}</p>}</div>}</div>
}

function TrashPanel({ records, onClose, onChanged, onError }: { records: TrashRecord[]; onClose: () => void; onChanged: () => Promise<void>; onError: (error: unknown) => void }): ReactElement {
  const restore = async (record: TrashRecord) => { try { await window.researchNotebook.trash.restore({ entityType: record.entityType, id: record.id, deletionOperationId: record.deletionOperationId }); await onChanged() } catch (cause) { onError(cause) } }
  const permanentlyDelete = async (record: TrashRecord) => { if (!window.confirm(`Permanently delete “${record.title}”? This cannot be undone.`)) return; try { await window.researchNotebook.trash.permanentlyDelete({ entityType: record.entityType, id: record.id }); await onChanged() } catch (cause) { onError(cause) } }
  const empty = async () => { if (!window.confirm('Permanently delete every item in Trash? This cannot be undone.')) return; try { await window.researchNotebook.trash.empty(); await onChanged() } catch (cause) { onError(cause) } }
  return <div className="trash-backdrop" role="dialog" aria-modal="true" aria-label="Trash"><section className="trash-panel"><header><h2>Trash</h2><button onClick={onClose}>Close</button></header><p>Items remain here until you restore or permanently delete them.</p>{records.length ? <><button className="danger" onClick={() => void empty()}>Empty Trash</button><ul>{records.map((record) => <li key={`${record.entityType}-${record.id}`}><div><strong>{record.title}</strong><small>{record.entityType} · deleted {new Date(record.deletedAt).toLocaleString()}</small></div><button onClick={() => void restore(record)}>Restore</button><button className="danger" onClick={() => void permanentlyDelete(record)}>Delete</button></li>)}</ul></> : <p className="empty-trash">Trash is empty.</p>}</section></div>
}
