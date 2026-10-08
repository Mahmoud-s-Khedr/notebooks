import React, { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react'
import { ChevronLeft, ChevronRight, FileText, Maximize2, Minus, Plus, Scissors, Upload } from 'lucide-react'
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
import type { BlockSource, PageWorkspace, SourceDocument } from '../../../../shared/domain'
import { Button } from '../../components/ui'

import { reconstructText, normalizedRectangle } from './pdf-text'

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
type Rectangle = { x: number; y: number; width: number; height: number; coordinateSpace?: 'pdf-points-bottom-left' }

export function SourceWorkspace({
  navigation,
  notebookId,
  workspace,
  activeNoteId,
  onSaved,
  onError
}: Props): ReactElement {
  const [sources, setSources] = useState<SourceDocument[]>([])
  const [source, setSource] = useState<SourceDocument | null>(null)
  const [url, setUrl] = useState('')
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [interaction, setInteraction] = useState<'text' | 'region'>('text')
  const [readerView, setReaderView] = useState<'page' | 'text'>('page')
  const [pageCount, setPageCount] = useState(0)
  // A null zoom follows the available pane width. Once the reader changes the
  // zoom controls, it becomes an explicit scale and is left alone.
  const [zoom, setZoom] = useState<number | null>(null)
  const [fitZoom, setFitZoom] = useState(1)
  const [printedPage, setPrintedPage] = useState('')
  const [selection, setSelection] = useState('')
  const [pageText, setPageText] = useState('')
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
    setPageText('')
    setRegion(null)
    setPrintedPage(
      navigation && navigation.sourceDocumentId === source?.id && navigation.pdfPage === page
        ? String(navigation.printedPage ?? '')
        : ''
    )
  }, [source?.id, page, navigation])
  useEffect(() => {
    const hasNavigatedExcerpt = Boolean(
      navigation &&
      navigation.sourceDocumentId === source?.id &&
      navigation.pdfPage === page &&
      navigation.extractedText
    )
    if (readerView === 'text' && pageText && !hasNavigatedExcerpt) setSelection(pageText)
  }, [navigation, page, pageText, readerView, source?.id])
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
  const captureText = async (text = selection) => {
    if (!noteId || !source || !text.trim()) return
    const context = captureContext.current
    try {
      await window.researchNotebook.sources.captureText({
        noteId,
        sourceDocumentId: source.id,
        pdfPage: page,
        printedPage: printedPage ? Number(printedPage) : undefined,
        text
      })
      if (captureContext.current === context) setSelection('')
      await onSaved()
    } catch (error) {
      onError(error)
    }
  }
  const createQa = async (text = selection) => {
    if (!workspace || !source || !text.trim()) return
    const context = captureContext.current
    try {
      const created = await window.researchNotebook.sources.createQaNote({
        pageId: workspace.id,
        sourceDocumentId: source.id,
        pdfPage: page,
        printedPage: printedPage ? Number(printedPage) : undefined,
        text
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
        printedPage: printedPage ? Number(printedPage) : undefined,
        imageDataUrl
      })
      if (captureContext.current === context) setRegion(null)
      await onSaved()
    } catch (error) {
      onError(error)
    }
  }
  return (
    <div className="source-workspace">
      <header className="source-header">
        <div className="source-heading">
          <span className="eyebrow">Source viewer</span>
          <h2 dir="auto">{source?.title ?? 'Read and capture'}</h2>
        </div>
        <select
          className="source-picker"
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
        <div className="source-header-actions">
          <Button variant="secondary" size="sm" disabled={!notebookId} onClick={() => void importPdf()}>
            <Upload size={15} /> Import PDF
          </Button>
        </div>
      </header>
      <div className="source-toolbar" aria-label="Capture mode">
        <Button
          size="sm"
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
          size="sm"
          variant={interaction === 'region' ? 'primary' : 'secondary'}
          aria-pressed={interaction === 'region'}
          onClick={() => setInteraction('region')}
        >
          Region
        </Button>
        <div className="reader-view-toggle" aria-label="Reader view">
          <Button
            size="sm"
            variant={readerView === 'page' ? 'primary' : 'secondary'}
            aria-pressed={readerView === 'page'}
            onClick={() => setReaderView('page')}
          >
            PDF page
          </Button>
          <Button
            size="sm"
            variant={readerView === 'text' ? 'primary' : 'secondary'}
            aria-pressed={readerView === 'text'}
            onClick={() => setReaderView('text')}
          >
            Page text
          </Button>
        </div>
        <div className="page-controls">
          <div className="page-navigation">
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
          </div>
          <div className="zoom-controls">
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
        </div>
        <span className="source-capture-target" role="status" title={destination?.title ?? 'Select a note to capture'}>
          Capture to: {destination?.title ?? 'Select a note to capture'}
        </span>
      </div>
      <div className={`source-reader ${readerView === 'text' ? 'page-text-view' : 'pdf-page-view'}`}>
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
            onPageText={setPageText}
            onText={setSelection}
            onCaptureText={(text) => void captureText(text)}
            onCreateQa={(text) => void createQa(text)}
            canCreateQa={Boolean(workspace)}
            onRegion={setRegion}
            onCaptureRegion={captureRegion}
            region={region}
          />
        ) : (
          <div className="source-empty">
            <FileText size={30} />
            <p>Import a PDF to read it beside your notes.</p>
          </div>
        )}
        {source && readerView === 'text' && (
          <section className="page-text-reader" aria-label="Page text reader">
            <div className="page-text-reader-heading">
              <strong>Page text</strong>
              <span>{pageText ? 'Editable extracted text' : 'Text is loading from this page…'}</span>
            </div>
            <textarea
              dir="auto"
              aria-label="Selected PDF text"
              value={selection}
              onChange={(event) => setSelection(event.target.value)}
              placeholder="Extracted page text will appear here…"
            />
          </section>
        )}
      </div>
      {source && readerView === 'text' && interaction === 'text' && (
        <footer className="capture-dock">
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
  onPageText,
  onText,
  onCaptureText,
  onCreateQa,
  canCreateQa,
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
  onPageText: (text: string) => void
  onText: (text: string) => void
  onCaptureText: (text: string) => void
  onCreateQa: (text: string) => void
  canCreateQa: boolean
  onRegion: (region: Rectangle | null) => void
  onCaptureRegion: (data: string, bounds: Rectangle) => void
  region: Rectangle | null
}): ReactElement {
  const textContainer = useRef<HTMLDivElement>(null)
  const [textContent, setTextContent] = useState<Awaited<ReturnType<pdfjs.PDFPageProxy['getTextContent']>> | null>(null)
  const textCache = useRef(new Map<number, Promise<Awaited<ReturnType<pdfjs.PDFPageProxy['getTextContent']>>>>())
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null)
  const completedRegion = useRef<Rectangle | null>(null)
  const viewportRef = useRef<ReturnType<pdfjs.PDFPageProxy['getViewport']> | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrapper = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const textActionsMenu = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pageWidth, setPageWidth] = useState(0)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [textActions, setTextActions] = useState<{ x: number; y: number; text: string } | null>(null)
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
        onPageText(reconstructText(content.items.filter((item) => 'str' in item)))
        if (initialText) onText(initialText)
      })
      .catch((reason) => {
        if (active) setError(String(reason))
      })
    return () => {
      active = false
    }
  }, [doc, page, onText, onPageText, initialText])
  useEffect(() => {
    if (!doc) return
    let active = true
    let renderTask: pdfjs.RenderTask | undefined
    let textLayer: pdfjs.TextLayer | undefined
    const render = async () => {
      const safePage = Math.min(Math.max(page, 1), doc.numPages)
      const pdfPage = await doc.getPage(safePage)
      if (!active || !canvas.current) return
      viewportRef.current = pdfPage.getViewport({ scale: effectiveZoom })
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
  const pointerPoint = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)),
      y: Math.min(rect.height, Math.max(0, event.clientY - rect.top))
    }
  }
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (interaction !== 'region' || !canCapture || event.button !== 0) return
    const point = pointerPoint(event)
    drag.current = { pointer: event.pointerId, ...point }
    completedRegion.current = null
    event.currentTarget.setPointerCapture?.(event.pointerId)
    onRegion({ ...point, width: 0, height: 0 })
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (interaction !== 'region' || drag.current?.pointer !== event.pointerId) return
    const rectangle = normalizedRectangle(drag.current, pointerPoint(event))
    completedRegion.current = rectangle
    onRegion(rectangle)
  }
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (interaction === 'text') return
    if (drag.current?.pointer !== event.pointerId) return
    const rectangle = normalizedRectangle(drag.current, pointerPoint(event))
    drag.current = null
    completedRegion.current = rectangle
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    onRegion(rectangle)
  }
  const cancel = () => {
    drag.current = null
    completedRegion.current = null
    onRegion(null)
  }
  useEffect(() => {
    drag.current = null
    completedRegion.current = null
    setTextActions(null)
    onRegion(null)
  }, [page, interaction, effectiveZoom, onRegion])
  useEffect(() => {
    if (!textActions) return
    const dismissOnOutsidePress = (event: globalThis.PointerEvent) => {
      if (!textActionsMenu.current?.contains(event.target as Node)) setTextActions(null)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTextActions(null)
    }
    window.addEventListener('pointerdown', dismissOnOutsidePress, true)
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      window.removeEventListener('pointerdown', dismissOnOutsidePress, true)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [textActions])
  const showTextActions = (point?: { x: number; y: number }) => {
    const selected = window.getSelection()
    const stage = wrapper.current
    if (!selected?.anchorNode || !stage?.contains(selected.anchorNode)) return false
    const text = selected.toString().trim()
    if (!text) return false
    const stageBounds = stage.getBoundingClientRect()
    const rangeBounds = selected.rangeCount ? selected.getRangeAt(0).getBoundingClientRect() : null
    const x = Math.min(
      Math.max(
        8,
        point?.x ?? (rangeBounds ? rangeBounds.left - stageBounds.left + rangeBounds.width / 2 : stageBounds.width / 2)
      ),
      Math.max(8, stageBounds.width - 8)
    )
    const y = Math.min(
      Math.max(8, point?.y ?? (rangeBounds ? rangeBounds.bottom - stageBounds.top + 8 : 24)),
      Math.max(8, stageBounds.height - 8)
    )
    onText(text)
    setTextActions({ x, y, text })
    return true
  }
  const contextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (interaction !== 'text') return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (showTextActions({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })) event.preventDefault()
  }
  const pdfBounds = (rectangle: Rectangle) => {
    const viewport = viewportRef.current
    if (!viewport) return null
    const [x1, y1] = viewport.convertToPdfPoint(rectangle.x, rectangle.y)
    const [x2, y2] = viewport.convertToPdfPoint(rectangle.x + rectangle.width, rectangle.y + rectangle.height)
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      coordinateSpace: 'pdf-points-bottom-left' as const
    }
  }
  const capture = () => {
    const rectangle = completedRegion.current
    if (!canCapture || !rectangle || rectangle.width < 8 || rectangle.height < 8 || !canvas.current) return
    const bounds = pdfBounds(rectangle)
    if (!bounds) return
    const scale = canvas.current.width / canvas.current.getBoundingClientRect().width
    const crop = document.createElement('canvas')
    crop.width = Math.round(rectangle.width * scale)
    crop.height = Math.round(rectangle.height * scale)
    const context = crop.getContext('2d')
    if (!context) return
    context.drawImage(
      canvas.current,
      Math.round(rectangle.x * scale),
      Math.round(rectangle.y * scale),
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height
    )
    onCaptureRegion(crop.toDataURL('image/png'), bounds)
  }
  return (
    <>
      <div className="pdf-scroll" ref={scroll}>
        <div
          className={`pdf-stage ${interaction}-selection`}
          ref={wrapper}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={cancel}
          onContextMenu={contextMenu}
          onLostPointerCapture={() => {
            drag.current = null
          }}
          tabIndex={0}
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
          {textActions && interaction === 'text' && (
            <div
              className="pdf-selection-actions"
              ref={textActionsMenu}
              role="toolbar"
              aria-label="Selected text actions"
              style={{ left: textActions.x, top: textActions.y }}
            >
              <Button
                size="sm"
                disabled={!canCapture}
                onClick={() => {
                  onCaptureText(textActions.text)
                  setTextActions(null)
                }}
              >
                Capture quote
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!canCreateQa}
                onClick={() => {
                  onCreateQa(textActions.text)
                  setTextActions(null)
                }}
              >
                Create Q&amp;A
              </Button>
            </div>
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
              : 'Select text, then right-click to reveal capture actions.'}
        </p>
      </div>
      {interaction === 'region' && (
        <div className="extraction-actions">
          <Button size="sm" disabled={!region?.width || !canCapture} onClick={capture}>
            Capture region
          </Button>
        </div>
      )}
    </>
  )
}
