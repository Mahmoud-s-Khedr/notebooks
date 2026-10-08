import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { block, installResearchNotebookApi, notebookTree, note, page, workspace } from './test/support'
import { bytes } from './format-bytes'

const withNote = (id: string, position = 0) => ({ ...note({ id, position, title: id }), blocks: [] })
describe('navigation and controls regressions', () => {
  let api: ReturnType<typeof installResearchNotebookApi>
  beforeEach(() => {
    api = installResearchNotebookApi()
    api.notebooks.list.mockResolvedValue([notebookTree()])
  })
  it('preserves active selection and loaded batches, and activates a note beyond the first batch', async () => {
    api.pages.getWorkspace.mockImplementation(async ({ cursor }) =>
      cursor
        ? workspace({ notes: [withNote('second', 50)], nextCursor: null })
        : workspace({ notes: [withNote('first')], nextCursor: '49' })
    )
    api.notes.create.mockResolvedValue(note({ id: 'second', position: 50 }))
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Topic page' }))
    await user.click(await screen.findByRole('button', { name: 'Load more notes' }))
    expect(screen.getAllByLabelText('Note title')).toHaveLength(2)
    await user.click(screen.getAllByLabelText('Note title')[1])
    await waitFor(() => expect(document.querySelector('[data-item-id="second"]')).toHaveClass('focused-note'))
    await user.click(screen.getAllByRole('button', { name: 'Add note' }).at(-1)!)
    await waitFor(() => expect(api.pages.getWorkspace).toHaveBeenCalledWith({ pageId: 'page-1', cursor: '49' }))
    expect(screen.getAllByLabelText('Note title')).toHaveLength(2)
    expect(document.querySelector('[data-item-id="second"]')).toHaveClass('focused-note')
  })
  it('ignores a stale page response', async () => {
    api.notebooks.list.mockResolvedValue([notebookTree({ pages: [page(), page({ id: 'page-2', title: 'New page' })] })])
    let old!: (value: ReturnType<typeof workspace>) => void
    api.pages.getWorkspace.mockImplementation(async ({ pageId }) =>
      pageId === 'page-1'
        ? new Promise((resolve) => {
            old = resolve
          })
        : workspace({ id: 'page-2', title: 'New page' })
    )
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Topic page' }))
    await user.click(screen.getByRole('button', { name: 'New page' }))
    old(workspace())
    expect(await screen.findByLabelText('Page title')).toHaveValue('New page')
  })
  it('filters notebook/page titles and shows no matches', async () => {
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Topic page' })
    const filter = screen.getByLabelText('Filter notebook and page titles')
    await user.type(filter, 'missing')
    expect(screen.getByText('No matching notebooks or pages.')).toBeVisible()
    await user.clear(filter)
    await user.type(filter, 'Topic')
    expect(screen.getByRole('button', { name: 'Topic page' })).toBeVisible()
  })
  it('opens the imported notebook immediately and leaves cancellation unchanged', async () => {
    const imported = notebookTree({
      id: 'imported',
      title: 'Imported',
      pages: [page({ id: 'imported-page', title: 'Imported page' })]
    })
    api.imports.start.mockResolvedValue({ notebook: imported, importedAssets: 0 })
    api.pages.getWorkspace.mockResolvedValue(workspace({ id: 'imported-page', title: 'Imported page' }))
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('button', { name: 'Topic page' })
    api.notebooks.list.mockResolvedValue([imported, notebookTree()])
    await user.click(screen.getByRole('button', { name: 'Application menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Import lossless archive…' }))
    expect(await screen.findByLabelText('Page title')).toHaveValue('Imported page')
    api.imports.start.mockResolvedValue(null)
    const calls = api.pages.getWorkspace.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'Application menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Import lossless archive…' }))
    expect(api.pages.getWorkspace).toHaveBeenCalledTimes(calls)
  })
  it('debounces search and distinguishes empty and failed results', async () => {
    render(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Search pages/ }))
    const input = screen.getByPlaceholderText('Search pages, notes, and blocks…')
    fireEvent.change(input, { target: { value: 'a' } })
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(screen.getByText('Searching…')).toBeVisible()
    expect(await screen.findByText('No matches.')).toBeVisible()
    expect(api.search).toHaveBeenCalledTimes(1)
    api.search.mockRejectedValue(new Error('Search unavailable'))
    fireEvent.change(input, { target: { value: 'fail' } })
    expect(await screen.findByText('Search failed. Edit the query to retry.')).toBeVisible()
  })
  it('saves editor text before changing pages', async () => {
    api.notebooks.list.mockResolvedValue([notebookTree({ pages: [page(), page({ id: 'other', title: 'Other' })] })])
    api.pages.getWorkspace.mockImplementation(async ({ pageId }) =>
      workspace({ id: pageId, notes: pageId === 'page-1' ? [{ ...note(), blocks: [block()] }] : [] })
    )
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Topic page' }))
    fireEvent.change(await screen.findByLabelText('text block'), { target: { value: 'Unsaved evidence' } })
    await user.click(screen.getByRole('button', { name: 'Other' }))
    await waitFor(() =>
      expect(api.blocks.update).toHaveBeenCalledWith({ blockId: 'block-1', data: { text: 'Unsaved evidence' } })
    )
    expect(api.blocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      api.pages.getWorkspace.mock.invocationCallOrder[1]
    )
  })
  it('formats attachment sizes without rounding megabytes to zero gigabytes', () => {
    expect([bytes(12), bytes(1200), bytes(12_000_000), bytes(1_200_000_000)]).toEqual([
      '12 B',
      '1.2 KB',
      '12.0 MB',
      '1.2 GB'
    ])
  })
})

describe('destructive and closure boundaries', () => {
  it('keeps the window open when editor saving fails and correlates a successful retry', async () => {
    const api = installResearchNotebookApi()
    api.notebooks.list.mockResolvedValue([notebookTree()])
    api.pages.getWorkspace.mockResolvedValue(workspace({ notes: [{ ...note(), blocks: [block()] }] }))
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Topic page' }))
    fireEvent.change(await screen.findByLabelText('text block'), { target: { value: 'Pending evidence' } })
    api.blocks.update.mockRejectedValueOnce(new Error('Disk full'))
    const handler = api.lifecycle.onCloseRequest.mock.calls[0][0]
    await handler('correlated-request')
    expect(api.lifecycle.closeResult).toHaveBeenCalledWith({ requestId: 'correlated-request', saved: false })
    await handler('retry-request')
    expect(api.lifecycle.closeResult).toHaveBeenLastCalledWith({ requestId: 'retry-request', saved: true })
  })
  it('requires accessible confirmation and defaults focus to Cancel before permanent deletion', async () => {
    const api = installResearchNotebookApi()
    api.trash.list.mockResolvedValue([
      {
        entityType: 'note',
        id: 'deleted-note',
        title: 'Important evidence',
        deletedAt: '2026-10-05',
        deletionOperationId: 'operation'
      }
    ])
    render(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Application menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'trash' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    const cancel = await screen.findByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(cancel).toHaveFocus())
    expect(api.trash.permanentlyDelete).not.toHaveBeenCalled()
    await user.click(cancel)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Permanently delete' }))
    await waitFor(() =>
      expect(api.trash.permanentlyDelete).toHaveBeenCalledWith({ entityType: 'note', id: 'deleted-note' })
    )
  })
})

describe('capture title consistency', () => {
  it('updates the explicit receiving title after note rename without clearing loaded notes', async () => {
    const api = installResearchNotebookApi()
    api.notebooks.list.mockResolvedValue([notebookTree()])
    api.pages.getWorkspace.mockResolvedValue(workspace({ notes: [{ ...note(), blocks: [] }] }))
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Topic page' }))
    fireEvent.change(await screen.findByLabelText('Note title'), { target: { value: 'Renamed receiver' } })
    fireEvent.blur(screen.getByLabelText('Note title'))
    await user.click(screen.getByRole('button', { name: 'Research' }))
    expect(await screen.findByText('Capture to: Renamed receiver')).toBeVisible()
  })
})

describe('refreshing search-opened batches', () => {
  it('preserves a distant active note and all loaded notes after an edit refresh', async () => {
    const api = installResearchNotebookApi()
    api.notebooks.list.mockResolvedValue([notebookTree()])
    api.pages.getWorkspace.mockImplementation(async ({ cursor }) => {
      const start = cursor ? Number(cursor) + 1 : 0
      const notes = Array.from({ length: Math.min(50, 200 - start) }, (_, i) =>
        withNote(`note-${start + i}`, start + i)
      )
      return workspace({ notes, nextCursor: start + 50 < 200 ? String(start + 49) : null })
    })
    api.search.mockResolvedValue([
      {
        entityType: 'note',
        entityId: 'note-150',
        notebookId: 'notebook-1',
        pageId: 'page-1',
        noteId: 'note-150',
        blockId: null,
        notePosition: 150,
        title: 'Distant result',
        excerpt: 'Evidence'
      }
    ])
    render(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Search pages/ }))
    await user.type(screen.getByPlaceholderText('Search pages, notes, and blocks…'), 'Evidence')
    await user.click(await screen.findByRole('button', { name: /Distant result/ }))
    await waitFor(() => expect(document.querySelector('[data-item-id="note-150"]')).toHaveClass('focused-note'))
    await user.click(screen.getAllByRole('button', { name: 'Add block' })[0])
    await waitFor(() => expect(screen.getAllByLabelText('Note title')).toHaveLength(200))
    expect(document.querySelector('[data-item-id="note-150"]')).toHaveClass('focused-note')
    expect(document.querySelector('[data-item-id="note-199"]')).toBeInTheDocument()
  }, 15_000)
})
