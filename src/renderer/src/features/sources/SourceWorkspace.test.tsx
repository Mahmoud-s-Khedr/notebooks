import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pdf = vi.hoisted(() => {
  const renderPage = vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() })
  const getPage = vi.fn(async (number: number) => ({
    getViewport: () => ({ width: 200, height: 100, convertToPdfPoint: (x: number, y: number) => [x, 100 - y] }),
    render: renderPage,
    getTextContent: async () => ({
      items: [
        { str: `Fixture PDF text page ${number}`, transform: [1, 0, 0, 12, 0, 80], height: 12, width: 180, dir: 'ltr' }
      ]
    })
  }))
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({ numPages: 2, getPage }),
    destroy: vi.fn().mockResolvedValue(undefined)
  }))
  return { renderPage, getPage, getDocument }
})

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: pdf.getDocument,
  TextLayer: class {
    render = () => Promise.resolve()
    cancel = () => undefined
  }
}))

import { SourceWorkspace } from './SourceWorkspace'
import { createResearchNotebookApi, installResearchNotebookApi, note, source, workspace } from '../../test/support'

const callbacks = () => ({ onSaved: vi.fn().mockResolvedValue(undefined), onError: vi.fn(), onUtilities: vi.fn() })

describe('SourceWorkspace core source-capture workflow', () => {
  let api: ReturnType<typeof createResearchNotebookApi>

  beforeEach(() => {
    api = installResearchNotebookApi()
    pdf.getDocument.mockClear()
    pdf.getPage.mockClear()
    pdf.renderPage.mockClear()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 100,
      right: 200,
      width: 100,
      height: 100,
      toJSON: () => ({})
    })
  })

  it('shows an import empty state and disables context-dependent controls', async () => {
    render(<SourceWorkspace notebookId={null} workspace={null} activeNoteId={null} {...callbacks()} />)

    expect(await screen.findByText('Import a PDF to read it beside your notes.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import PDF' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Attach media' })).not.toBeInTheDocument()
  })

  it('imports a PDF and refreshes source choices', async () => {
    const user = userEvent.setup()
    const document = source()
    api.sources.importPdf.mockResolvedValue(document)
    api.sources.list.mockResolvedValue([document])
    api.assets.dataUrl.mockResolvedValue('data:application/pdf;base64,fixture')

    render(
      <SourceWorkspace
        notebookId="notebook-1"
        workspace={workspace({ notes: [{ ...note(), blocks: [] }] })}
        activeNoteId={null}
        {...callbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Import PDF' }))

    await waitFor(() => expect(api.sources.importPdf).toHaveBeenCalledWith({ notebookId: 'notebook-1' }))
    expect(api.sources.list).toHaveBeenCalledWith({ notebookId: 'notebook-1' })
    expect(await screen.findByRole('option', { name: 'Fixture source' })).toBeInTheDocument()
  })

  it('loads fixture-like PDF metadata and extracted text, navigates pages, and captures text', async () => {
    const user = userEvent.setup()
    const document = source()
    const onSaved = vi.fn().mockResolvedValue(undefined)
    api.sources.list.mockResolvedValue([document])
    api.assets.dataUrl.mockResolvedValue('data:application/pdf;base64,fixture')

    render(
      <SourceWorkspace
        notebookId="notebook-1"
        workspace={workspace({ notes: [{ ...note(), blocks: [] }] })}
        activeNoteId="note-1"
        onSaved={onSaved}
        onError={vi.fn()}
        onUtilities={vi.fn()}
      />
    )

    expect(await screen.findByText('of 2')).toBeVisible()
    const selectedText = screen.getByRole('textbox', { name: 'Selected PDF text' })
    expect(selectedText).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Extract page text' }))
    await waitFor(() => expect(selectedText).toHaveValue('Fixture PDF text page 1'))
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Extract page text' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Extract page text' }))
    await waitFor(() => expect(selectedText).toHaveValue('Fixture PDF text page 2'))
    await user.type(screen.getByRole('spinbutton', { name: 'Printed page' }), '12')
    await user.click(screen.getByRole('button', { name: 'Capture text' }))

    await waitFor(() =>
      expect(api.sources.captureText).toHaveBeenCalledWith({
        noteId: 'note-1',
        sourceDocumentId: 'source-1',
        pdfPage: 2,
        printedPage: 12,
        text: 'Fixture PDF text page 2'
      })
    )
    expect(onSaved).toHaveBeenCalled()
  })

  it.each([
    [10, 20, 60, 60],
    [60, 60, 10, 20],
    [10, 60, 60, 20],
    [60, 20, 10, 60]
  ])('normalizes region drag %j and keeps released selections stable', async (x1, y1, x2, y2) => {
    const user = userEvent.setup()
    api.sources.list.mockResolvedValue([source()])
    api.assets.dataUrl.mockResolvedValue('data:application/pdf;base64,fixture')
    render(
      <SourceWorkspace
        notebookId="notebook-1"
        workspace={workspace({ notes: [{ ...note(), blocks: [] }] })}
        activeNoteId="note-1"
        {...callbacks()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Region' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Extract page text' })).toBeEnabled())
    const stage = screen.getByLabelText('PDF page. Drag to capture an image region.')
    fireEvent.pointerDown(stage, { clientX: x1, clientY: y1, pointerId: 1, button: 0 })
    fireEvent.pointerMove(stage, { clientX: x2, clientY: y2, pointerId: 1 })
    fireEvent.pointerUp(stage, { clientX: x2, clientY: y2, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 99, clientY: 99, pointerId: 1 })
    expect(api.sources.captureRegion).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Printed page'), '7')
    await user.click(screen.getByRole('button', { name: 'Capture region' }))
    expect(api.sources.captureRegion).toHaveBeenCalledWith({
      noteId: 'note-1',
      sourceDocumentId: 'source-1',
      pdfPage: 1,
      printedPage: 7,
      bounds: { x: 10, y: 40, width: 50, height: 40, coordinateSpace: 'pdf-points-bottom-left' },
      imageDataUrl: 'data:image/png;base64,renderer-test-capture'
    })
  })

  it('cancels an unfinished region without creating a capture', async () => {
    const user = userEvent.setup()
    api.sources.list.mockResolvedValue([source()])
    api.assets.dataUrl.mockResolvedValue('data:application/pdf;base64,fixture')
    render(<SourceWorkspace notebookId="notebook-1" workspace={workspace()} activeNoteId="note-1" {...callbacks()} />)
    await user.click(screen.getByRole('button', { name: 'Region' }))
    const stage = await screen.findByLabelText('PDF page. Drag to capture an image region.')
    fireEvent.pointerDown(stage, { clientX: 10, clientY: 10, pointerId: 1, button: 0 })
    fireEvent.pointerMove(stage, { clientX: 80, clientY: 70, pointerId: 1 })
    fireEvent.pointerCancel(stage, { pointerId: 1 })
    expect(screen.getByRole('button', { name: 'Capture region' })).toBeDisabled()
    expect(api.sources.captureRegion).not.toHaveBeenCalled()
  })

  it('propagates source import errors to the owning workspace', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    api.sources.importPdf.mockRejectedValue(new Error('Picker unavailable'))
    render(
      <SourceWorkspace
        notebookId="notebook-1"
        workspace={workspace({ notes: [{ ...note(), blocks: [] }] })}
        activeNoteId="note-1"
        onSaved={vi.fn()}
        onError={onError}
        onUtilities={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Import PDF' }))
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Picker unavailable' }))
    )
  })
})

describe('PDF interaction regression', () => {
  it('preserves edited text through zoom, clamps committed pages and clears printed provenance on page changes', async () => {
    const api = installResearchNotebookApi()
    api.sources.list.mockResolvedValue([source()])
    api.assets.dataUrl.mockResolvedValue('data:application/pdf;base64,fixture')
    const user = userEvent.setup()
    render(
      <SourceWorkspace
        notebookId="notebook-1"
        workspace={workspace({ notes: [{ ...note(), blocks: [] }] })}
        activeNoteId="note-1"
        {...callbacks()}
      />
    )
    const text = await screen.findByRole('textbox', { name: 'Selected PDF text' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Extract page text' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Extract page text' }))
    await waitFor(() => expect(text).toHaveValue('Fixture PDF text page 1'))
    await user.clear(text)
    await user.type(text, 'Edited evidence')
    await user.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(text).toHaveValue('Edited evidence')
    const input = screen.getByLabelText('PDF page')
    fireEvent.change(input, { target: { value: '999' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(input).toHaveValue(2))
    fireEvent.change(screen.getByLabelText('Printed page'), { target: { value: '77' } })
    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(screen.getByLabelText('Printed page')).toHaveValue(null)
    expect(screen.getByRole('button', { name: 'Text' })).toHaveAttribute('aria-pressed', 'true')
  })
  it('disables capture without an explicit receiving note', async () => {
    const api = installResearchNotebookApi()
    api.sources.list.mockResolvedValue([source()])
    api.assets.dataUrl.mockResolvedValue('data:application/pdf;base64,fixture')
    render(
      <SourceWorkspace
        notebookId="notebook-1"
        workspace={workspace({ notes: [{ ...note(), blocks: [] }] })}
        activeNoteId={null}
        {...callbacks()}
      />
    )
    expect(await screen.findByRole('button', { name: 'Capture text' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Attach media' })).not.toBeInTheDocument()
    expect(screen.getByText('Capture to: Select a note to capture')).toBeVisible()
  })
})

describe('source navigation consumption', () => {
  it('applies provenance once and then permits manual source switching after import', async () => {
    const api = installResearchNotebookApi()
    const first = source()
    const second = source({ id: 'source-2', assetId: 'asset-2', title: 'Comparison' })
    api.sources.list.mockResolvedValue([first])
    api.assets.dataUrl.mockResolvedValue('data:application/pdf;base64,fixture')
    const user = userEvent.setup()
    render(
      <SourceWorkspace
        navigation={{
          id: 'provenance',
          blockId: 'block-1',
          sourceDocumentId: first.id,
          pdfPage: 1,
          printedPage: 17,
          selectionType: 'text',
          bounds: null,
          extractedText: 'Recorded evidence',
          createdAt: '2026-10-05'
        }}
        notebookId="notebook-1"
        workspace={workspace({ notes: [{ ...note(), blocks: [] }] })}
        activeNoteId="note-1"
        {...callbacks()}
      />
    )
    await waitFor(() => expect(screen.getByLabelText('Printed page')).toHaveValue(17))
    api.sources.list.mockResolvedValue([first, second])
    await user.click(screen.getByRole('button', { name: 'Import PDF' }))
    await screen.findByRole('option', { name: 'Comparison' })
    await user.selectOptions(screen.getByLabelText('Source document'), 'source-2')
    await waitFor(() => expect(screen.getByLabelText('Source document')).toHaveValue('source-2'))
    expect(screen.getByLabelText('Printed page')).toHaveValue(null)
  })
})

describe('source failures and retained selections', () => {
  it.each(['list', 'asset'] as const)('reports a source %s loading failure', async (boundary) => {
    const api = installResearchNotebookApi()
    const props = callbacks()
    const failure = new Error('Source unavailable')
    if (boundary === 'list') api.sources.list.mockRejectedValueOnce(failure)
    else {
      api.sources.list.mockResolvedValue([source()])
      api.assets.dataUrl.mockRejectedValueOnce(failure)
    }
    render(<SourceWorkspace notebookId="notebook-1" workspace={workspace()} activeNoteId={null} {...props} />)
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(failure))
    expect(api.sources.captureText).not.toHaveBeenCalled()
  })
  it('retains selected text after capture and Q&A failures so the reader can retry', async () => {
    const api = installResearchNotebookApi()
    const props = callbacks()
    api.sources.list.mockResolvedValue([source()])
    api.assets.dataUrl.mockResolvedValue('data:application/pdf;base64,fixture')
    render(
      <SourceWorkspace
        notebookId="notebook-1"
        workspace={workspace({ notes: [{ ...note(), blocks: [] }] })}
        activeNoteId="note-1"
        {...props}
      />
    )
    await screen.findByText('of 2')
    const selected = screen.getByRole('textbox', { name: 'Selected PDF text' })
    fireEvent.change(selected, { target: { value: 'Selected evidence' } })
    api.sources.captureText.mockRejectedValueOnce(new Error('Capture failed'))
    await userEvent.click(screen.getByRole('button', { name: 'Capture text' }))
    await waitFor(() =>
      expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Capture failed' }))
    )
    expect(selected).toHaveValue('Selected evidence')
    expect(props.onSaved).not.toHaveBeenCalled()
    api.sources.createQaNote.mockRejectedValueOnce(new Error('Q&A failed'))
    await userEvent.click(screen.getByRole('button', { name: 'Create Q&A' }))
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Q&A failed' })))
    expect(selected).toHaveValue('Selected evidence')
    await userEvent.click(screen.getByRole('button', { name: 'Capture text' }))
    await waitFor(() => expect(selected).toHaveValue(''))
    expect(props.onSaved).toHaveBeenCalledOnce()
    expect(api.sources.captureText).toHaveBeenLastCalledWith({
      noteId: 'note-1',
      sourceDocumentId: 'source-1',
      pdfPage: 1,
      printedPage: undefined,
      text: 'Selected evidence'
    })
  })
})
