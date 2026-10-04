import React, { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Maximize2,
  Minus,
  MoreHorizontal,
  Plus,
  Scissors,
  Upload
} from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { AssetKind, PageWorkspace, SourceDocument } from '../../../../shared/domain'
import { Button, DropdownMenu } from '../../components/ui'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
  notebookId: string | null
  workspace: PageWorkspace | null
  activeNoteId: string | null
  onSaved: () => Promise<void>
  onError: (error: unknown) => void
  onUtilities: (kind: 'settings' | 'diagnostics' | 'export' | 'jobs') => void
}
type Rectangle = { x: number; y: number; width: number; height: number }

export function SourceWorkspace({
  notebookId,
  workspace,
  activeNoteId,
  onSaved,
  onError,
  onUtilities
}: Props): ReactElement {
  const [sources, setSources] = useState<SourceDocument[]>([])
  const [source, setSource] = useState<SourceDocument | null>(null)
  const [url, setUrl] = useState('')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(1.1)
  const [printedPage, setPrintedPage] = useState('')
  const [selection, setSelection] = useState('')
  const [region, setRegion] = useState<Rectangle | null>(null)
  const noteId = activeNoteId ?? workspace?.notes[0]?.id
  const refresh = useCallback(async () => {
    if (!notebookId) {
      setSources([])
      setSource(null)
      return
    }
    const next = await window.researchNotebook.sources.list({ notebookId })
    setSources(next)
    setSource((current) => (current && next.some(({ id }) => id === current.id) ? current : (next[0] ?? null)))
  }, [notebookId])
  useEffect(() => {
    void refresh().catch(onError)
  }, [refresh, onError])
  useEffect(() => {
    if (!source) {
      setUrl('')
      return
    }
    void window.researchNotebook.assets.dataUrl({ assetId: source.assetId }).then(setUrl).catch(onError)
  }, [source, onError])
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceDocumentId: string; pdfPage: number | null }>).detail
      const next = sources.find(({ id }) => id === detail.sourceDocumentId)
      if (next) {
        setSource(next)
        setPage(detail.pdfPage ?? 1)
      }
    }
    window.addEventListener('research-notebook:open-source', open)
    return () => window.removeEventListener('research-notebook:open-source', open)
  }, [sources])
  const importPdf = async () => {
    if (!notebookId) return
    try {
      await window.researchNotebook.sources.importPdf({ notebookId })
      await refresh()
    } catch (error) {
      onError(error)
    }
  }
  const captureText = async () => {
    if (!noteId || !source || !selection.trim()) return
    try {
      await window.researchNotebook.sources.captureText({
        noteId,
        sourceDocumentId: source.id,
        pdfPage: page,
        printedPage: printedPage ? Number(printedPage) : undefined,
        text: selection
      })
      setSelection('')
      await onSaved()
    } catch (error) {
      onError(error)
    }
  }
  const createQa = async () => {
    if (!workspace || !source || !selection.trim()) return
    try {
      await window.researchNotebook.sources.createQaNote({
        pageId: workspace.id,
        sourceDocumentId: source.id,
        pdfPage: page,
        printedPage: printedPage ? Number(printedPage) : undefined,
        text: selection
      })
      setSelection('')
      await onSaved()
    } catch (error) {
      onError(error)
    }
  }
  const captureRegion = async (imageDataUrl: string, bounds: Rectangle) => {
    if (!noteId || !source) return
    try {
      await window.researchNotebook.sources.captureRegion({
        noteId,
        sourceDocumentId: source.id,
        pdfPage: page,
        bounds,
        imageDataUrl
      })
      setRegion(null)
      await onSaved()
    } catch (error) {
      onError(error)
    }
  }
  const importAsset = async (kind: AssetKind) => {
    if (!notebookId || !noteId) return
    try {
      const asset = await window.researchNotebook.assets.import({ notebookId, kind })
      if (asset) await window.researchNotebook.assets.attach({ noteId, assetId: asset.id, type: kind })
      await onSaved()
    } catch (error) {
      onError(error)
    }
  }
  return (
    <div className="source-workspace">
      <header className="source-header">
        <div>
          <span className="eyebrow">Source viewer</span>
          <h2>{source?.title ?? 'Read and capture'}</h2>
        </div>
        <div className="source-header-actions">
          <Button variant="ghost" size="icon" aria-label="Import PDF" onClick={() => void importPdf()}>
            <Upload size={17} />
          </Button>
          <Button variant="secondary" size="sm" disabled={!notebookId} onClick={() => void importPdf()}>
            <FileText size={15} /> Import
          </Button>
        </div>
      </header>
      <div className="source-toolbar">
        <select
          aria-label="Source document"
          value={source?.id ?? ''}
          onChange={(event) => setSource(sources.find(({ id }) => id === event.target.value) ?? null)}
        >
          <option value="">{sources.length ? 'Choose a source' : 'No sources yet'}</option>
          {sources.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <div className="toolbar-grow" />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label="Attach media" disabled={!noteId}>
              <Upload size={16} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu-content" align="end">
              {(['image', 'screenshot', 'audio', 'file'] as const).map((kind) => (
                <DropdownMenu.Item className="menu-item" key={kind} onSelect={() => void importAsset(kind)}>
                  Attach {kind}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <Button variant="ghost" size="icon" aria-label="Source settings" onClick={() => onUtilities('settings')}>
          <MoreHorizontal size={17} />
        </Button>
      </div>
      {url ? (
        <PdfCanvas
          url={url}
          page={page}
          zoom={zoom}
          onPageCount={setPageCount}
          onText={setSelection}
          onRegion={setRegion}
          onCaptureRegion={captureRegion}
          region={region}
        />
      ) : (
        <div className="source-empty">
          <FileText size={30} />
          <p>Import a PDF to read it beside your notes.</p>
          <Button onClick={() => void importPdf()} disabled={!notebookId}>
            Import PDF
          </Button>
        </div>
      )}
      {source && (
        <footer className="capture-dock">
          <div className="page-controls">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft size={17} />
            </Button>
            <label>
              Page{' '}
              <input
                aria-label="PDF page"
                type="number"
                min="1"
                max={pageCount || undefined}
                value={page}
                onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))}
              />{' '}
              <span>of {pageCount || '–'}</span>
            </label>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next page"
              disabled={pageCount > 0 && page >= pageCount}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight size={17} />
            </Button>
            <span className="separator" />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom out"
              onClick={() => setZoom((value) => Math.max(0.65, value - 0.1))}
            >
              <Minus size={16} />
            </Button>
            <span className="zoom-label">{Math.round(zoom * 100)}%</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom in"
              onClick={() => setZoom((value) => Math.min(2.1, value + 0.1))}
            >
              <Plus size={16} />
            </Button>
          </div>
          <div className="capture-actions">
            <label className="printed-page">
              Print p.{' '}
              <input
                aria-label="Printed page"
                type="number"
                min="1"
                value={printedPage}
                onChange={(event) => setPrintedPage(event.target.value)}
              />
            </label>
            <Button
              variant="secondary"
              size="sm"
              disabled={!selection.trim() || !noteId}
              onClick={() => void captureText()}
            >
              <Scissors size={15} /> Capture text
            </Button>
            <Button size="sm" disabled={!selection.trim()} onClick={() => void createQa()}>
              Create Q&A
            </Button>
          </div>
          <textarea
            aria-label="Selected PDF text"
            value={selection}
            onChange={(event) => setSelection(event.target.value)}
            placeholder="Select text in the PDF, or edit the extracted text here…"
          />
        </footer>
      )}
    </div>
  )
}

function PdfCanvas({
  url,
  page,
  zoom,
  onPageCount,
  onText,
  onRegion,
  onCaptureRegion,
  region
}: {
  url: string
  page: number
  zoom: number
  onPageCount: (count: number) => void
  onText: (text: string) => void
  onRegion: (region: Rectangle | null) => void
  onCaptureRegion: (data: string, bounds: Rectangle) => void
  region: Rectangle | null
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const loadingTask = pdfjs.getDocument({ url })
    setLoading(true)
    setError(null)
    setDoc(null)
    onPageCount(0)
    void loadingTask.promise
      .then((pdf) => {
        if (!active) return
        // Keeping the loaded document in state is essential: it triggers the
        // render effect below after the asynchronous open completes.
        setDoc(pdf)
        onPageCount(pdf.numPages)
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'The PDF could not be opened.')
          onPageCount(0)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      void loadingTask.destroy()
    }
  }, [url, onPageCount])
  useEffect(() => {
    if (!doc) return
    let active = true
    let renderTask: pdfjs.RenderTask | undefined
    const render = async () => {
      const safePage = Math.min(Math.max(page, 1), doc.numPages)
      const pdfPage = await doc.getPage(safePage)
      if (!active || !canvas.current) return
      const deviceScale = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = pdfPage.getViewport({ scale: zoom * deviceScale })
      const target = canvas.current
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      target.style.width = `${Math.ceil(viewport.width / deviceScale)}px`
      target.style.height = `${Math.ceil(viewport.height / deviceScale)}px`
      const context = target.getContext('2d')
      if (!context) throw new Error('Canvas rendering is unavailable.')
      renderTask = pdfPage.render({ canvas: target, canvasContext: context, viewport })
      await renderTask.promise
      if (active) {
        const text = await pdfPage.getTextContent()
        onText(text.items.map((item) => ('str' in item ? item.str : '')).join(' '))
      }
    }
    void render().catch((reason: unknown) => {
      // Page changes cancel the preceding render; that is expected rather than an error.
      if (active && (reason as { name?: string }).name !== 'RenderingCancelledException')
        setError(reason instanceof Error ? reason.message : 'The PDF page could not be rendered.')
    })
    return () => {
      active = false
      renderTask?.cancel()
    }
  }, [doc, page, zoom, onText])
  const start = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, event.clientX - rect.left)
    const y = Math.max(0, event.clientY - rect.top)
    event.currentTarget.setPointerCapture(event.pointerId)
    onRegion({ x, y, width: 0, height: 0 })
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!region) return
    const rect = event.currentTarget.getBoundingClientRect()
    onRegion({
      ...region,
      width: Math.max(0, Math.min(rect.width - region.x, event.clientX - rect.left - region.x)),
      height: Math.max(0, Math.min(rect.height - region.y, event.clientY - rect.top - region.y))
    })
  }
  const finish = () => {
    if (!region || region.width < 8 || region.height < 8 || !canvas.current) return
    const scale = canvas.current.width / canvas.current.getBoundingClientRect().width
    const crop = document.createElement('canvas')
    crop.width = Math.round(region.width * scale)
    crop.height = Math.round(region.height * scale)
    const context = crop.getContext('2d')
    if (!context) return
    context.drawImage(
      canvas.current,
      Math.round(region.x * scale),
      Math.round(region.y * scale),
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    )
    onCaptureRegion(crop.toDataURL('image/png'), {
      x: Math.round(region.x * scale),
      y: Math.round(region.y * scale),
      width: crop.width,
      height: crop.height
    })
  }
  return (
    <div className="pdf-scroll">
      <div
        className="pdf-stage"
        ref={wrapper}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        aria-label="PDF page. Drag to capture an image region."
      >
        <canvas ref={canvas} />
        {region && (
          <div
            className="pdf-region"
            style={{ left: region.x, top: region.y, width: region.width, height: region.height }}
          />
        )}
        {loading && <div className="pdf-loading">Rendering PDF…</div>}
        {error && <div className="pdf-loading">Unable to render PDF: {error}</div>}
      </div>
      <p className="pdf-help">
        <Maximize2 size={13} /> Drag on the page to capture a region.
      </p>
    </div>
  )
}
