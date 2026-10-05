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
import './pdf-text-layer.css'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import jbig2WasmUrl from 'pdfjs-dist/wasm/jbig2.wasm?url'
import jbig2NoWasmFallbackUrl from 'pdfjs-dist/wasm/jbig2_nowasm_fallback.js?url'
import openJpegWasmUrl from 'pdfjs-dist/wasm/openjpeg.wasm?url'
import openJpegNoWasmFallbackUrl from 'pdfjs-dist/wasm/openjpeg_nowasm_fallback.js?url'
import qcmsWasmUrl from 'pdfjs-dist/wasm/qcms_bg.wasm?url'
import quickJsLoaderUrl from 'pdfjs-dist/wasm/quickjs-eval.js?url'
import quickJsWasmUrl from 'pdfjs-dist/wasm/quickjs-eval.wasm?url'
import type { BlockSource, AssetKind, PageWorkspace, SourceDocument } from '../../../../shared/domain'
import { Button, DropdownMenu } from '../../components/ui'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// The decoder is requested as `${wasmUrl}<decoder filename>`. Every import is
// intentionally retained so the matching decoder and fallback files are
// emitted beside one another in both development and packaged builds.
const pdfjsWasmUrls = [
  jbig2WasmUrl,
  jbig2NoWasmFallbackUrl,
  openJpegWasmUrl,
  openJpegNoWasmFallbackUrl,
  qcmsWasmUrl,
  quickJsLoaderUrl,
  quickJsWasmUrl
]
const pdfjsWasmUrl = jbig2WasmUrl.replace(/jbig2\.wasm(?:\?.*)?$/, '')

if (!pdfjsWasmUrls.every((url) => url.startsWith(pdfjsWasmUrl))) {
  throw new Error('PDF.js decoder assets must be emitted into one directory.')
}

type Props = {
  navigation?: BlockSource | null
  notebookId: string | null
  workspace: PageWorkspace | null
  activeNoteId: string | null
  onSaved: (activateId?: string) => Promise<void>
  onError: (error: unknown) => void
  onUtilities: (kind: 'settings' | 'diagnostics' | 'export' | 'jobs') => void
}
type Rectangle = { x: number; y: number; width: number; height: number }

export function SourceWorkspace({
  navigation,
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
  const [pageInput, setPageInput] = useState('1')
  const [interaction, setInteraction] = useState<'text' | 'region'>('text')
  const [pageCount, setPageCount] = useState(0)
  // A null zoom follows the available pane width. Once the reader changes the
  // zoom controls, it becomes an explicit scale and is left alone.
  const [zoom, setZoom] = useState<number | null>(null)
  const [fitZoom, setFitZoom] = useState(1)
  const [printedPage, setPrintedPage] = useState('')
  const [selection, setSelection] = useState('')
  const [region, setRegion] = useState<Rectangle | null>(null)
  const noteId = activeNoteId
  const destination = workspace?.notes.find((n) => n.id === noteId)
  const appliedNavigation = useRef<BlockSource | null>(null)
  const sourceRequest = useRef(0)
  const captureContext = useRef('')
  useEffect(() => {
    captureContext.current = `${source?.id}:${page}:${noteId}`
  }, [source?.id, page, noteId])
  const refresh = useCallback(async () => {
    const token = ++sourceRequest.current
    if (!notebookId) {
      setSources([])
      setSource(null)
      return
    }
    const next = await window.researchNotebook.sources.list({ notebookId })
    if (token !== sourceRequest.current) return
    setSources(next)
    setSource((current) => (current && next.some(({ id }) => id === current.id) ? current : (next[0] ?? null)))
  }, [notebookId])
  const invalidateSources = useCallback(() => {
    ++sourceRequest.current
  }, [])
  useEffect(() => {
    void refresh().catch(onError)
    return invalidateSources
  }, [refresh, onError, invalidateSources])
  useEffect(() => {
    let alive = true
    setUrl('')
    if (source)
      void window.researchNotebook.assets
        .dataUrl({ assetId: source.assetId })
        .then((value) => {
          if (alive) setUrl(value)
        })
        .catch((value) => {
          if (alive) onError(value)
        })
    return () => {
      alive = false
    }
  }, [source, onError])
  useEffect(() => {
    setZoom(null)
  }, [url])
  useEffect(() => {
    if (!navigation || appliedNavigation.current === navigation) return
    const next = sources.find((s) => s.id === navigation.sourceDocumentId)
    if (next) {
      appliedNavigation.current = navigation
      setSource(next)
      setPage(navigation.pdfPage ?? 1)
    }
  }, [navigation, sources])
  useEffect(() => {
    setPageInput(String(page))
    setSelection('')
    setRegion(null)
    setPrintedPage(
      navigation && navigation.sourceDocumentId === source?.id && navigation.pdfPage === page
        ? String(navigation.printedPage ?? '')
        : ''
    )
  }, [source?.id, page, navigation])
  const acceptPage = () => {
    const safe = Math.max(1, Math.min(pageCount || 1, Math.trunc(Number(pageInput)) || 1))
    setPage(safe)
    setPageInput(String(safe))
  }
  const acceptCount = useCallback((count: number) => {
    setPageCount(count)
    if (count) setPage((value) => Math.min(Math.max(1, value), count))
  }, [])
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
    const context = captureContext.current
    try {
      await window.researchNotebook.sources.captureText({
        noteId,
        sourceDocumentId: source.id,
        pdfPage: page,
        printedPage: printedPage ? Number(printedPage) : undefined,
        text: selection
      })
      if (captureContext.current === context) setSelection('')
      await onSaved()
    } catch (error) {
      onError(error)
    }
  }
  const createQa = async () => {
    if (!workspace || !source || !selection.trim()) return
    const context = captureContext.current
    try {
      const created = await window.researchNotebook.sources.createQaNote({
        pageId: workspace.id,
        sourceDocumentId: source.id,
        pdfPage: page,
        printedPage: printedPage ? Number(printedPage) : undefined,
        text: selection
      })
      if (captureContext.current === context) setSelection('')
      await onSaved(created.id)
    } catch (error) {
      onError(error)
    }
  }
  const captureRegion = async (imageDataUrl: string, bounds: Rectangle) => {
    if (!noteId || !source) return
    const context = captureContext.current
    try {
      await window.researchNotebook.sources.captureRegion({
        noteId,
        sourceDocumentId: source.id,
        pdfPage: page,
        bounds,
        imageDataUrl
      })
      if (captureContext.current === context) setRegion(null)
      await onSaved()
    } catch (error) {
      onError(error)
    }
  }
  const importAsset = async (kind: AssetKind) => {
    if (!notebookId || !noteId) return
    try {
      const target = noteId
      const asset = await window.researchNotebook.assets.import({ notebookId, kind })
      if (asset) await window.researchNotebook.assets.attach({ noteId: target, assetId: asset.id, type: kind })
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
          onChange={(event) => {
            setSource(sources.find(({ id }) => id === event.target.value) ?? null)
            setPage(1)
            setPageCount(0)
          }}
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
      <div className="source-toolbar" aria-label="Capture mode">
        <Button
          variant={interaction === 'text' ? 'primary' : 'secondary'}
          aria-pressed={interaction === 'text'}
          onClick={() => {
            setInteraction('text')
            setRegion(null)
          }}
        >
          Text
        </Button>
        <Button
          variant={interaction === 'region' ? 'primary' : 'secondary'}
          aria-pressed={interaction === 'region'}
          onClick={() => setInteraction('region')}
        >
          Region
        </Button>
        <span role="status">Capture to: {destination?.title ?? 'Select a note to capture'}</span>
      </div>
      {url ? (
        <PdfCanvas
          key={source?.id}
          initialText={
            navigation?.sourceDocumentId === source?.id && navigation?.pdfPage === page
              ? navigation?.extractedText
              : null
          }
          interaction={interaction}
          canCapture={Boolean(noteId)}
          url={url}
          page={page}
          zoom={zoom}
          onFitZoom={setFitZoom}
          onPageCount={acceptCount}
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
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                onBlur={acceptPage}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') acceptPage()
                }}
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
              onClick={() => setZoom((value) => Math.max(Math.min(0.65, fitZoom / 2), (value ?? fitZoom) - 0.1))}
            >
              <Minus size={16} />
            </Button>
            <span className="zoom-label">{Math.round((zoom ?? fitZoom) * 100)}%</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom in"
              onClick={() => setZoom((value) => Math.min(Math.max(2.1, fitZoom + 0.5), (value ?? fitZoom) + 0.1))}
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
            <Button size="sm" disabled={!workspace || !selection.trim()} onClick={() => void createQa()}>
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
  initialText,
  interaction,
  canCapture,
  url,
  page,
  zoom,
  onFitZoom,
  onPageCount,
  onText,
  onRegion,
  onCaptureRegion,
  region
}: {
  initialText?: string | null
  interaction: 'text' | 'region'
  canCapture: boolean
  url: string
  page: number
  zoom: number | null
  onFitZoom: (zoom: number) => void
  onPageCount: (count: number) => void
  onText: (text: string) => void
  onRegion: (region: Rectangle | null) => void
  onCaptureRegion: (data: string, bounds: Rectangle) => void
  region: Rectangle | null
}): ReactElement {
  const textContainer = useRef<HTMLDivElement>(null)
  const [textContent, setTextContent] = useState<Awaited<ReturnType<pdfjs.PDFPageProxy['getTextContent']>> | null>(null)
  const textCache = useRef(new Map<number, Promise<Awaited<ReturnType<pdfjs.PDFPageProxy['getTextContent']>>>>())
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageWidth, setPageWidth] = useState(0)
  const [availableWidth, setAvailableWidth] = useState(0)
  const fitZoom = pageWidth && availableWidth ? Math.max(0.1, availableWidth / pageWidth) : 1
  const effectiveZoom = zoom ?? fitZoom
  useEffect(() => {
    const updateWidth = () => setAvailableWidth(Math.max(0, (scroll.current?.clientWidth ?? 0) - 4))
    updateWidth()
    const observer = typeof ResizeObserver === 'undefined' || !scroll.current ? null : new ResizeObserver(updateWidth)
    if (scroll.current) observer?.observe(scroll.current)
    window.addEventListener('resize', updateWidth)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateWidth)
    }
  }, [])
  useEffect(() => {
    if (zoom === null && pageWidth && availableWidth) onFitZoom(fitZoom)
  }, [availableWidth, fitZoom, onFitZoom, pageWidth, zoom])
  useEffect(() => {
    let active = true
    const loadingTask = pdfjs.getDocument({ url, wasmUrl: pdfjsWasmUrl })
    setLoading(true)
    setError(null)
    setDoc(null)
    textCache.current.clear()
    setTextContent(null)
    setPageWidth(0)
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
    const safe = Math.max(1, Math.min(page, doc.numPages))
    let text = textCache.current.get(safe)
    if (!text) {
      text = doc.getPage(safe).then((p) => p.getTextContent())
      textCache.current.set(safe, text)
    }
    setTextContent(null)
    void text
      .then((content) => {
        if (!active) return
        setTextContent(content)
        onText(initialText ?? content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
      })
      .catch((reason) => {
        if (active) setError(String(reason))
      })
    return () => {
      active = false
    }
  }, [doc, page, onText, initialText])
  useEffect(() => {
    if (!doc) return
    let active = true
    let renderTask: pdfjs.RenderTask | undefined
    let textLayer: pdfjs.TextLayer | undefined
    const render = async () => {
      const safePage = Math.min(Math.max(page, 1), doc.numPages)
      const pdfPage = await doc.getPage(safePage)
      if (!active || !canvas.current) return
      const baseViewport = pdfPage.getViewport({ scale: 1 })
      if (active) setPageWidth(baseViewport.width)
      const deviceScale = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = pdfPage.getViewport({ scale: effectiveZoom * deviceScale })
      const target = canvas.current
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      target.style.width = `${Math.ceil(viewport.width / deviceScale)}px`
      target.style.height = `${Math.ceil(viewport.height / deviceScale)}px`
      const context = target.getContext('2d')
      if (!context) throw new Error('Canvas rendering is unavailable.')
      renderTask = pdfPage.render({ canvas: target, canvasContext: context, viewport })
      await renderTask.promise
      if (active && textContent && textContainer.current) {
        textContainer.current.replaceChildren()
        const viewport = pdfPage.getViewport({ scale: effectiveZoom })
        textContainer.current.style.setProperty('--scale-factor', String(effectiveZoom))
        textContainer.current.style.setProperty('--total-scale-factor', String(effectiveZoom))
        textLayer = new pdfjs.TextLayer({ textContentSource: textContent, container: textContainer.current, viewport })
        await textLayer.render()
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
      textLayer?.cancel()
    }
  }, [doc, effectiveZoom, textContent, page])
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (interaction !== 'region' || !canCapture) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, event.clientX - rect.left)
    const y = Math.max(0, event.clientY - rect.top)
    event.currentTarget.setPointerCapture(event.pointerId)
    onRegion({ x, y, width: 0, height: 0 })
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (interaction !== 'region' || !region) return
    const rect = event.currentTarget.getBoundingClientRect()
    onRegion({
      ...region,
      width: Math.max(0, Math.min(rect.width - region.x, event.clientX - rect.left - region.x)),
      height: Math.max(0, Math.min(rect.height - region.y, event.clientY - rect.top - region.y))
    })
  }
  const finish = () => {
    if (interaction === 'text') {
      const selected = window.getSelection()
      if (selected?.anchorNode && wrapper.current?.contains(selected.anchorNode) && selected.toString().trim())
        onText(selected.toString())
      return
    }
    if (!canCapture || !region || region.width < 8 || region.height < 8 || !canvas.current) return
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
    <div className="pdf-scroll" ref={scroll}>
      <div
        className={`pdf-stage ${interaction}-selection`}
        ref={wrapper}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        aria-label="PDF page. Drag to capture an image region."
      >
        <canvas ref={canvas} />
        <div
          className="textLayer"
          ref={textContainer}
          style={{ pointerEvents: interaction === 'text' ? 'auto' : 'none' }}
        />
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
        <Maximize2 size={13} />{' '}
        {interaction === 'region'
          ? 'Drag on the page to capture a region.'
          : textContent && !textContent.items.length
            ? 'No selectable text. Use Region or type evidence manually. OCR is not available.'
            : 'Select text on the page, or edit the extracted text below.'}
      </p>
    </div>
  )
}
