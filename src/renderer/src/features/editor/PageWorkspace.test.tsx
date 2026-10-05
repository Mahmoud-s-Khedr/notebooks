import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PageWorkspace } from './PageWorkspace'
import { block, createResearchNotebookApi, installResearchNotebookApi, note, workspace } from '../../test/support'

const callbacks = () => ({
  reloadWorkspace: vi.fn().mockResolvedValue(undefined),
  loadMore: vi.fn().mockResolvedValue(undefined),
  setActiveNoteId: vi.fn(),
  onError: vi.fn(),
  onChanged: vi.fn().mockResolvedValue(undefined),
  onTrashed: vi.fn().mockResolvedValue(undefined),
  onViewSource: vi.fn(),
  onUtilities: vi.fn()
})

const renderWorkspace = (overrides = {}, callbackOverrides = {}) => {
  const props = callbacks()
  Object.assign(props, callbackOverrides)
  return {
    ...props,
    ...render(
      <PageWorkspace
        workspace={workspace(overrides)}
        notebookId="notebook-1"
        mode="write"
        activeNoteId={null}
        {...props}
      />
    )
  }
}

describe('PageWorkspace core writing workflow', () => {
  let api: ReturnType<typeof createResearchNotebookApi>

  beforeEach(() => {
    api = installResearchNotebookApi()
  })

  it('shows the empty state and creates notes from both empty-state and toolbar controls', async () => {
    const user = userEvent.setup()
    const view = renderWorkspace()
    expect(screen.getByText('This topic has no notes yet.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Create first note' }))
    await waitFor(() => expect(api.notes.create).toHaveBeenCalledWith({ pageId: 'page-1', title: 'Untitled note' }))
    expect(view.setActiveNoteId).toHaveBeenCalledWith('note-1')

    await user.click(screen.getByRole('button', { name: 'Add note' }))
    expect(api.notes.create).toHaveBeenCalledTimes(2)
  })

  it('saves a changed page title on blur', async () => {
    const user = userEvent.setup()
    const view = renderWorkspace()
    const title = screen.getByRole('textbox', { name: 'Page title' })
    await user.clear(title)
    await user.type(title, 'Field notes')
    fireEvent.blur(title)

    await waitFor(() => expect(api.pages.update).toHaveBeenCalledWith({ pageId: 'page-1', title: 'Field notes' }))
    expect(view.reloadWorkspace).toHaveBeenCalled()
    expect(view.onChanged).toHaveBeenCalled()
  })

  it('adds default and selected typed blocks', async () => {
    const user = userEvent.setup()
    renderWorkspace({ notes: [{ ...note(), blocks: [] }] })

    await user.click(screen.getByRole('button', { name: 'Add block' }))
    await waitFor(() =>
      expect(api.blocks.create).toHaveBeenCalledWith({ noteId: 'note-1', type: 'text', data: { text: '' } })
    )

    await user.click(screen.getByRole('button', { name: 'Open block command menu' }))
    await user.click(await screen.findByRole('button', { name: /\/explanation/i }))
    await waitFor(() =>
      expect(api.blocks.create).toHaveBeenLastCalledWith({ noteId: 'note-1', type: 'explanation', data: { text: '' } })
    )
  })

  it('saves edited text blocks on blur', async () => {
    const user = userEvent.setup()
    renderWorkspace({ notes: [{ ...note(), blocks: [block()] }] })
    const editor = screen.getByRole('textbox', { name: 'text block' })
    await user.clear(editor)
    await user.type(editor, 'Revised thought')
    fireEvent.blur(editor)

    await waitFor(() =>
      expect(api.blocks.update).toHaveBeenCalledWith({ blockId: 'block-1', data: { text: 'Revised thought' } })
    )
  })

  it('reorders blocks through action menu and keyboard paths with exact IDs', async () => {
    const user = userEvent.setup()
    const first = block({ id: 'first', data: { text: 'First' } })
    const second = block({ id: 'second', position: 1, data: { text: 'Second' } })
    renderWorkspace({ notes: [{ ...note(), blocks: [first, second] }] })

    await user.click(screen.getAllByRole('button', { name: 'Actions for text block' })[0])
    await user.click(await screen.findByRole('menuitem', { name: 'Move down' }))
    await waitFor(() =>
      expect(api.blocks.reorder).toHaveBeenCalledWith({ noteId: 'note-1', blockIds: ['second', 'first'] })
    )

    const editors = screen.getAllByRole('textbox', { name: 'text block' })
    fireEvent.keyDown(editors[1], { key: 'ArrowUp', altKey: true })
    await waitFor(() =>
      expect(api.blocks.reorder).toHaveBeenLastCalledWith({ noteId: 'note-1', blockIds: ['second', 'first'] })
    )
  })

  it('reorders blocks by dropping a drag handle above or below another block', async () => {
    const first = block({ id: 'first', data: { text: 'First' } })
    const second = block({ id: 'second', position: 1, data: { text: 'Second' } })
    renderWorkspace({ notes: [{ ...note(), blocks: [first, second] }] })
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      data: new Map<string, string>(),
      setData(type: string, value: string) {
        this.data.set(type, value)
      },
      getData(type: string) {
        return this.data.get(type) ?? ''
      }
    }
    const handles = screen.getAllByRole('button', { name: 'Drag text block to reorder' })
    const target = screen.getAllByRole('textbox', { name: 'text block' })[1].closest('section')!

    fireEvent.dragStart(handles[0], { dataTransfer })
    fireEvent.dragOver(target, { dataTransfer, clientY: 0 })
    fireEvent.drop(target, { dataTransfer })

    await waitFor(() =>
      expect(api.blocks.reorder).toHaveBeenCalledWith({ noteId: 'note-1', blockIds: ['second', 'first'] })
    )
  })

  it('links blocks in the inspector and routes trash and relation failures to the error callback', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    const first = block({ id: 'first', data: { text: 'First' } })
    const second = block({ id: 'second', position: 1, data: { text: 'Second' } })
    const view = renderWorkspace({ notes: [{ ...note(), blocks: [first, second] }] }, { onError })

    await user.click(screen.getAllByRole('button', { name: 'Actions for text block' })[0])
    await user.click(await screen.findByRole('menuitem', { name: 'Inspector' }))
    const inspector = await screen.findByRole('dialog', { name: 'Block inspector' })
    await user.selectOptions(within(inspector).getByRole('combobox', { name: 'Block to link' }), 'second')
    await user.click(within(inspector).getByRole('button', { name: 'Link' }))
    await waitFor(() =>
      expect(api.relations.create).toHaveBeenCalledWith({
        fromBlockId: 'first',
        toBlockId: 'second',
        relationType: 'explains'
      })
    )

    api.trash.move.mockRejectedValueOnce(new Error('Cannot trash'))
    await user.click(within(inspector).getByRole('button', { name: 'Move to trash' }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cannot trash' })))
    expect(view.onTrashed).not.toHaveBeenCalled()
  })
})
