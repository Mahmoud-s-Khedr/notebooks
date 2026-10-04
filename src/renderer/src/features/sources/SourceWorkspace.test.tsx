import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pdf = vi.hoisted(() => {
  const renderPage = vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() })
  const getPage = vi.fn(async (number: number) => ({
    getViewport: () => ({ width: 200, height: 100 }),
    render: renderPage,
    getTextContent: async () => ({ items: [{ str: `Fixture PDF text page ${number}` }] })
  }))
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({ numPages: 2, getPage }),
    destroy: vi.fn().mockResolvedValue(undefined)
  }))
  return { renderPage, getPage, getDocument }
})

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: pdf.getDocument }))

import { SourceWorkspace } from './SourceWorkspace'
import {
  asset,
  createResearchNotebookApi,
  installResearchNotebookApi,
  note,
  source,
  workspace
} from '../../test/support'

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
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Attach media' })).toBeDisabled()
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
    await user.click(screen.getByRole('button', { name: 'Import' }))

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
    await waitFor(() => expect(selectedText).toHaveValue('Fixture PDF text page 1'))
    await user.click(screen.getByRole('button', { name: 'Next page' }))
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

  it('captures regions using deterministic canvas coordinates and dispatches attached media', async () => {
    const user = userEvent.setup()
    const document = source()
    api.sources.list.mockResolvedValue([document])
    api.assets.dataUrl.mockResolvedValue('data:application/pdf;base64,fixture')
    api.assets.import.mockResolvedValue(asset({ id: 'audio-asset', kind: 'audio' }))

    render(
      <SourceWorkspace
        notebookId="notebook-1"
        workspace={workspace({ notes: [{ ...note(), blocks: [] }] })}
        activeNoteId="note-1"
        {...callbacks()}
      />
    )
    const stage = await screen.findByLabelText('PDF page. Drag to capture an image region.')
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Selected PDF text' })).toHaveValue('Fixture PDF text page 1')
    )
    const rectangle = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 100,
      right: 100,
      width: 100,
      height: 100,
      toJSON: () => ({})
    }
    const canvas = stage.querySelector('canvas')!
    canvas.width = 200
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(rectangle)
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rectangle)
    fireEvent.pointerDown(stage, { clientX: 10, clientY: 20, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 60, clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(stage, { pointerId: 1 })

    await waitFor(() =>
      expect(api.sources.captureRegion).toHaveBeenCalledWith({
        noteId: 'note-1',
        sourceDocumentId: 'source-1',
        pdfPage: 1,
        bounds: { x: 20, y: 40, width: 100, height: 80 },
        imageDataUrl: 'data:image/png;base64,renderer-test-capture'
      })
    )

    await user.click(screen.getByRole('button', { name: 'Attach media' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Attach audio' }))
    await waitFor(() => expect(api.assets.import).toHaveBeenCalledWith({ notebookId: 'notebook-1', kind: 'audio' }))
    expect(api.assets.attach).toHaveBeenCalledWith({ noteId: 'note-1', assetId: 'audio-asset', type: 'audio' })
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

    await user.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Picker unavailable' }))
    )
  })

  it('propagates attached-media errors to the owning workspace', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    api.sources.list.mockResolvedValue([source()])
    api.assets.dataUrl.mockResolvedValue('data:application/pdf;base64,fixture')
    api.assets.import.mockRejectedValue(new Error('Media import failed'))

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
    await user.click(await screen.findByRole('button', { name: 'Attach media' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Attach image' }))

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Media import failed' }))
    )
  })
})
