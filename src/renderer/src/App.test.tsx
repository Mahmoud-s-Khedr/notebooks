import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import {
  createResearchNotebookApi,
  installResearchNotebookApi,
  notebook,
  notebookTree,
  page,
  preferences,
  workspace
} from './test/support'

describe('App core notebook workflow', () => {
  let api: ReturnType<typeof createResearchNotebookApi>

  beforeEach(() => {
    api = installResearchNotebookApi()
  })

  it('loads the notebook tree and applies saved appearance preferences', async () => {
    api.notebooks.list.mockResolvedValue([notebookTree()])
    api.settings.preferences.mockResolvedValue(preferences({ theme: 'dark', density: 'compact' }))

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Topic page' })).toBeVisible()
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'))
    expect(document.documentElement).toHaveAttribute('data-density', 'compact')
  })

  it('creates a first page for a new notebook, refreshes, and opens it', async () => {
    const user = userEvent.setup()
    const createdNotebook = notebook({ id: 'notebook-new', title: 'Untitled notebook' })
    const createdPage = page({ id: 'page-new', notebookId: createdNotebook.id, title: 'Untitled page' })
    api.notebooks.create.mockResolvedValue(createdNotebook)
    api.pages.create.mockResolvedValue(createdPage)
    api.notebooks.list.mockResolvedValue([notebookTree({ ...createdNotebook, pages: [createdPage] })])
    api.pages.getWorkspace.mockResolvedValue(workspace({ ...createdPage }))

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'New notebook' }))

    await waitFor(() => expect(api.notebooks.create).toHaveBeenCalledWith({ title: 'Untitled notebook' }))
    expect(api.pages.create).toHaveBeenCalledWith({ notebookId: 'notebook-new', title: 'Untitled page' })
    expect(api.pages.getWorkspace).toHaveBeenCalledWith({ pageId: 'page-new', cursor: undefined })
    expect(await screen.findByDisplayValue('Untitled page')).toBeVisible()
  })

  it('opens a selected page and dispatches title rename calls', async () => {
    const user = userEvent.setup()
    const selected = page({ id: 'page-two', title: 'Second page' })
    api.notebooks.list.mockResolvedValue([notebookTree({ pages: [page(), selected] })])
    api.pages.getWorkspace.mockResolvedValue(workspace({ ...selected }))

    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Second page' }))
    expect(api.pages.getWorkspace).toHaveBeenCalledWith({ pageId: 'page-two', cursor: undefined })
    expect(await screen.findByDisplayValue('Second page')).toBeVisible()

    const title = screen.getByRole('textbox', { name: 'Notebook title' })
    await user.clear(title)
    await user.type(title, 'Renamed research')
    fireEvent.blur(title)
    await waitFor(() =>
      expect(api.notebooks.update).toHaveBeenCalledWith({ notebookId: 'notebook-1', title: 'Renamed research' })
    )

    const pageTitle = screen.getByRole('textbox', { name: 'Page title' })
    await user.clear(pageTitle)
    await user.type(pageTitle, 'Renamed page')
    fireEvent.blur(pageTitle)
    await waitFor(() => expect(api.pages.update).toHaveBeenCalledWith({ pageId: 'page-two', title: 'Renamed page' }))
  })

  it('shows a dismissible alert when a core request fails', async () => {
    const user = userEvent.setup()
    api.notebooks.list.mockRejectedValue(new Error('Library unavailable'))

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Library unavailable')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('opens search by keyboard and only creates notes from the shortcut with an active workspace', async () => {
    const user = userEvent.setup()
    api.notebooks.list.mockResolvedValue([notebookTree()])
    api.pages.getWorkspace.mockResolvedValue(workspace({ notes: [noteWithNoBlocks()] }))

    render(<App />)
    await screen.findByRole('button', { name: 'Topic page' })
    await user.keyboard('{Control>}{Shift>}n{/Shift}{/Control}')
    expect(api.notes.create).not.toHaveBeenCalled()

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: 'Search your notebook' })).toBeVisible()
    expect(screen.getByPlaceholderText('Search notes, sources, or ask…')).toHaveFocus()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Topic page' }))
    await screen.findByRole('textbox', { name: 'Page title' })
    await user.keyboard('{Control>}{Shift>}n{/Shift}{/Control}')
    await waitFor(() => expect(api.notes.create).toHaveBeenCalledWith({ pageId: 'page-1', title: 'Untitled note' }))
  })
})

function noteWithNoBlocks() {
  return {
    id: 'note-1',
    pageId: 'page-1',
    title: 'First note',
    position: 0,
    deletedAt: null,
    deletionOperationId: null,
    createdAt: '2026-10-04T12:00:00.000Z',
    updatedAt: '2026-10-04T12:00:00.000Z',
    blocks: []
  }
}
