import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { installResearchNotebookApi, notebookTree, workspace, note, preferences } from './test/support'

let api: ReturnType<typeof installResearchNotebookApi>
beforeEach(() => {
  api = installResearchNotebookApi()
  api.notebooks.list.mockResolvedValue([notebookTree()])
})
afterEach(() => vi.restoreAllMocks())
const menu = async (name: string) => {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Application menu' }))
  await user.click(await screen.findByRole('menuitem', { name }))
}
const open = async (name: string, page = false) => {
  render(<App />)
  await screen.findByRole('button', { name: 'Topic page' })
  if (page) {
    await userEvent.click(screen.getByRole('button', { name: 'Topic page' }))
    await screen.findByRole('textbox', { name: 'Page title' })
  }
  await menu(name)
}
const job = (id: string, status: string, extra = {}) => ({
  id,
  status,
  kind: 'export',
  progress: 42,
  errorMessage: null,
  ...extra
})
const model = (id: string, extra = {}) => ({
  id,
  displayName: id,
  sizeBytes: 1024,
  installed: false,
  state: 'not-installed',
  progress: null,
  error: null,
  ...extra
})

describe('App settings and library utilities', () => {
  it('saves appearance and density, reports failure, and returns to the workspace', async () => {
    await open('settings')
    api.settings.updatePreferences.mockResolvedValue(preferences({ theme: 'dark' }))
    fireEvent.change(screen.getByLabelText('Appearance'), { target: { value: 'dark' } })
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    expect(api.settings.updatePreferences).toHaveBeenCalledWith({ theme: 'dark' })
    api.settings.updatePreferences.mockResolvedValue(preferences({ density: 'compact' }))
    fireEvent.change(screen.getByLabelText('Layout density'), { target: { value: 'compact' } })
    await waitFor(() => expect(document.documentElement.dataset.density).toBe('compact'))
    api.settings.updatePreferences.mockRejectedValueOnce(new Error('Preferences locked'))
    fireEvent.change(screen.getByLabelText('Appearance'), { target: { value: 'light' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Preferences locked')
    await userEvent.click(screen.getByRole('button', { name: 'Back to workspace' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument())
  })

  it('saves, replaces and removes credentials with confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await open('settings')
    await userEvent.click(screen.getByRole('button', { name: 'Transcription' }))
    expect(await screen.findByText('No API key is configured.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save key' })).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Enter API key'), { target: { value: 'test-secret' } })
    api.settings.transcription.mockResolvedValue({ openRouterConfigured: true })
    await userEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect(api.settings.setOpenRouterKey).toHaveBeenCalledWith({ key: 'test-secret' })
    expect(await screen.findByText('An API key is configured locally.')).toBeVisible()
    expect(screen.getByPlaceholderText('Enter API key')).toHaveValue('')
    fireEvent.change(screen.getByPlaceholderText('Enter API key'), { target: { value: 'replacement' } })
    api.settings.setOpenRouterKey.mockRejectedValueOnce(new Error('Key rejected'))
    await userEvent.click(screen.getByRole('button', { name: 'Replace key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Key rejected')
    await userEvent.click(screen.getByRole('button', { name: 'Remove key' }))
    expect(api.settings.removeOpenRouterKey).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Remove key' }))
    expect(await screen.findByText('No API key is configured.')).toBeVisible()
    await waitFor(() => expect(api.settings.removeOpenRouterKey).toHaveBeenCalledOnce())
  })

  it('manages installed, downloading and failed models and clears its polling timer', async () => {
    const clear = vi.spyOn(window, 'clearInterval')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const models = [
      model('default', { installed: true }),
      model('other', { installed: true }),
      model('download'),
      model('failed', { state: 'failed', error: 'Network failed' }),
      model('running', { state: 'downloading', progress: 0.42 }),
      model('unknown', { state: 'downloading' })
    ]
    api.settings.models.mockResolvedValue(models)
    api.settings.transcription.mockResolvedValue({
      openRouterConfigured: true,
      credentialPersistenceAvailable: true,
      selectedLocalModel: { id: 'default' }
    })
    await open('settings')
    await userEvent.click(screen.getByRole('button', { name: 'Transcription' }))
    expect(await screen.findByRole('button', { name: 'Default' })).toBeDisabled()
    expect(screen.getByText(/Downloading 42%/)).toBeVisible()
    expect(screen.getByText(/Network failed/)).toBeVisible()
    expect(screen.getByText('Credentials are encrypted with operating-system secure storage.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Use as default' }))
    expect(api.settings.setDefaultModel).toHaveBeenCalledWith({ modelId: 'other' })
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(api.settings.removeModel).toHaveBeenCalledWith({ modelId: 'other' })
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(api.settings.downloadModel).toHaveBeenCalledWith({ modelId: 'download' })
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.settings.downloadModel).toHaveBeenCalledWith({ modelId: 'failed' })
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
    expect(api.settings.cancelModelDownload).toHaveBeenCalledWith({ modelId: 'running' })
    await userEvent.click(screen.getByRole('button', { name: 'General' }))
    expect(clear).toHaveBeenCalled()
  })

  it('refreshes storage, cancels a move and confirms removal of the old library', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    api.settings.storage.mockResolvedValue({
      libraryPath: '/active',
      oldLibraryPath: '/old',
      databaseBytes: 1024,
      assetsBytes: 2048,
      modelsBytes: 0,
      migration: { state: 'idle' }
    })
    await open('settings')
    await userEvent.click(screen.getByRole('button', { name: 'Library & Storage' }))
    expect(await screen.findByText('/active')).toBeVisible()
    expect(api.settings.storage).toHaveBeenCalledWith({ refresh: true })
    await userEvent.click(screen.getByRole('button', { name: 'Refresh storage' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move library…' }))
    expect(api.settings.moveLibrary).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Remove original' }))
    expect(api.settings.removeOldLibrary).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Remove original' }))
    expect(api.settings.removeOldLibrary).toHaveBeenCalledOnce()
  })

  it('pauses editing after a verified move and restarts from the banner', async () => {
    api.settings.migrationStatus.mockResolvedValue({ state: 'pending-restart' })
    render(<App />)
    expect(await screen.findByText(/Library move verified/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'New notebook' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }))
    expect(api.lifecycle.restart).toHaveBeenCalledOnce()
  })

  it('previews, cancels and applies history cleanup and performs maintenance actions', async () => {
    api.jobs.list.mockResolvedValue([
      job('running', 'running'),
      job('failed', 'failed', { errorMessage: 'failed job' })
    ])
    api.diagnostics.cleanup.mockResolvedValue(3)
    api.diagnostics.export.mockResolvedValue('/export/diagnostics.txt')
    await open('settings', true)
    await userEvent.click(screen.getByRole('button', { name: 'Maintenance' }))
    expect(await screen.findByText('running · 42%')).toBeVisible()
    fireEvent.change(screen.getByLabelText('jobs retention days'), { target: { value: '7' } })
    await userEvent.click(screen.getAllByRole('button', { name: 'Preview cleanup' })[0])
    expect(api.diagnostics.cleanup).toHaveBeenCalledWith({ kind: 'jobs', days: 7 })
    await userEvent.click(screen.getByRole('button', { name: 'Keep history' }))
    expect(screen.queryByRole('button', { name: 'Confirm cleanup' })).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Preview cleanup' })[0])
    await userEvent.click(screen.getByRole('button', { name: 'Confirm cleanup' }))
    expect(await screen.findByText('Removed 3 finished jobs.')).toBeVisible()
    expect(api.diagnostics.cleanup).toHaveBeenCalledWith({ kind: 'jobs', days: 7, apply: true })
    await userEvent.selectOptions(screen.getByLabelText('jobs cleanup range'), 'all')
    expect(screen.queryByLabelText('jobs retention days')).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Preview cleanup' })[0])
    expect(api.diagnostics.cleanup).toHaveBeenCalledWith({ kind: 'jobs', days: 0 })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm cleanup' }))
    expect(api.diagnostics.cleanup).toHaveBeenCalledWith({ kind: 'jobs', days: 0, apply: true })
    await userEvent.click(screen.getByRole('button', { name: 'Back up library' }))
    expect(api.backups.start).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Scan active notebook assets' }))
    expect(await screen.findByText('0 missing · 0 unreferenced · 0 corrupt · 0 globally untracked')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Export diagnostics' }))
    expect(await screen.findByText('Exported to /export/diagnostics.txt')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.jobs.cancel).toHaveBeenCalledWith({ jobId: 'running' })
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.jobs.retry).toHaveBeenCalledWith({ jobId: 'failed' })
  })

  it('lists jobs, retries failures, cancels active work and stops polling when closed', async () => {
    const clear = vi.spyOn(window, 'clearInterval')
    api.jobs.list.mockResolvedValue([
      job('queued', 'queued'),
      job('running', 'running'),
      job('failed', 'failed', { errorMessage: 'Job failed' }),
      job('cancelled', 'cancelled')
    ])
    await open('jobs')
    expect(await screen.findByText('Job failed')).toBeVisible()
    for (const button of screen.getAllByRole('button', { name: 'Cancel' })) await userEvent.click(button)
    for (const button of screen.getAllByRole('button', { name: 'Retry' })) await userEvent.click(button)
    expect(api.jobs.cancel.mock.calls).toEqual([[{ jobId: 'queued' }], [{ jobId: 'running' }]])
    expect(api.jobs.retry.mock.calls).toEqual([[{ jobId: 'failed' }], [{ jobId: 'cancelled' }]])
    await userEvent.keyboard('{Escape}')
    expect(clear).toHaveBeenCalled()
  })

  it('filters and inspects diagnostics, scans assets and exports local records', async () => {
    const record = {
      id: 'error-1',
      message: 'Save failed',
      process: 'main',
      severity: 'error',
      category: 'save',
      createdAt: '2026-10-04',
      context: { detail: 'disk full' }
    }
    api.diagnostics.listErrors.mockResolvedValue([record])
    api.diagnostics.getError.mockResolvedValue(record)
    await open('diagnostics', true)
    expect(await screen.findByText(/Save failed/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('Filter errors by process'), { target: { value: 'main' } })
    fireEvent.change(screen.getByLabelText('Filter errors by severity'), { target: { value: 'error' } })
    fireEvent.change(screen.getByLabelText('Filter errors by category'), { target: { value: ' save ' } })
    await waitFor(() =>
      expect(api.diagnostics.listErrors).toHaveBeenLastCalledWith({
        process: 'main',
        severity: 'error',
        category: 'save'
      })
    )
    await userEvent.click(screen.getByText(/Save failed/))
    await userEvent.click(screen.getByRole('button', { name: 'Show full detail' }))
    expect(await screen.findByText(/disk full/)).toBeVisible()
    expect(api.diagnostics.getError).toHaveBeenCalledWith({ id: 'error-1' })
    await userEvent.click(screen.getByRole('button', { name: 'Scan assets' }))
    expect(await screen.findByText(/0 missing/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Export diagnostics' }))
    expect(await screen.findByText('No diagnostics to export.')).toBeVisible()
    api.diagnostics.export.mockResolvedValue('/errors.txt')
    await userEvent.click(screen.getByRole('button', { name: 'Export diagnostics' }))
    expect(await screen.findByText('Exported to /errors.txt')).toBeVisible()
  })

  it('restores trash and requires confirmation before permanent deletion', async () => {
    const record = {
      entityType: 'note',
      id: 'deleted',
      title: 'Deleted note',
      deletedAt: '2026-10-04',
      deletionOperationId: 'operation'
    }
    api.trash.list.mockResolvedValue([record])
    await open('trash')
    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }))
    expect(api.trash.restore).toHaveBeenCalledWith({
      entityType: 'note',
      id: 'deleted',
      deletionOperationId: 'operation'
    })
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Permanently delete item?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.trash.permanentlyDelete).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    api.trash.list.mockResolvedValue([])
    await userEvent.click(screen.getByRole('button', { name: 'Permanently delete' }))
    expect(api.trash.permanentlyDelete).toHaveBeenCalledWith({ entityType: 'note', id: 'deleted' })
    expect(await screen.findByText('Trash is empty.')).toBeVisible()
  })

  it('imports an archive and opens its first page, and supports cancelled import', async () => {
    await open('jobs')
    await userEvent.keyboard('{Escape}')
    await menu('Import lossless archive…')
    expect(api.imports.start).toHaveBeenCalledOnce()
    api.imports.start.mockResolvedValue({ notebook: { id: 'notebook-1' } })
    await menu('Import lossless archive…')
    expect(await screen.findByRole('textbox', { name: 'Page title' })).toBeVisible()
    expect(api.pages.getWorkspace).toHaveBeenCalledWith({ pageId: 'page-1', cursor: undefined })
    await menu('Back up library')
    expect(api.backups.start).toHaveBeenCalledOnce()
  })

  it('filters the sidebar, creates pages by Enter and toggles workspace modes', async () => {
    await open('jobs')
    await userEvent.keyboard('{Escape}')
    fireEvent.change(screen.getByLabelText('Filter notebook and page titles'), { target: { value: 'missing' } })
    expect(screen.getByText('No matching notebooks or pages.')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Filter notebook and page titles'), { target: { value: 'topic' } })
    expect(screen.getByRole('button', { name: 'Topic page' })).toBeVisible()
    fireEvent.change(screen.getByLabelText('New page for Research'), { target: { value: ' New topic ' } })
    fireEvent.keyDown(screen.getByLabelText('New page for Research'), { key: 'Enter' })
    await waitFor(() => expect(api.pages.create).toHaveBeenCalledWith({ notebookId: 'notebook-1', title: 'New topic' }))
    await userEvent.click(screen.getByRole('button', { name: 'Research' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Research' })).toHaveAttribute('aria-pressed', 'true')
    )
    await userEvent.click(screen.getByRole('button', { name: 'Write' }))
    await userEvent.click(screen.getByRole('button', { name: 'Collapse notebook sidebar' }))
    expect(screen.queryByRole('complementary', { name: 'Notebooks' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expand notebook sidebar' }))
    expect(screen.getByLabelText('Filter notebook and page titles')).toBeVisible()
  })
})

describe('App export and search flows', () => {
  const exportPage = async () => {
    api.pages.getWorkspace.mockResolvedValue(workspace({ notes: [{ ...note(), blocks: [] }] }))
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Topic page' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Page actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Export page' }))
    await screen.findByRole('dialog', { name: 'Export' })
  }
  it('exports each format and scope, handles folder cancellation and opens completed output', async () => {
    await exportPage()
    for (const [scope, format, expected] of [
      ['notebook', 'markdown', { type: 'notebook', notebookId: 'notebook-1' }],
      ['page', 'pdf', { type: 'page', pageId: 'page-1' }],
      ['note', 'lossless json', { type: 'note', noteId: 'note-1' }],
      ['note', 'ai context', { type: 'note', noteId: 'note-1' }]
    ] as const) {
      fireEvent.change(screen.getByLabelText('Scope'), { target: { value: scope } })
      await userEvent.click(screen.getByRole('button', { name: format }))
      await screen.findByText('Export complete')
      expect(api.exports.start).toHaveBeenLastCalledWith({ scope: expected, format: format.replace(' ', '-') })
    }
    await userEvent.click(screen.getByRole('button', { name: 'Open export folder' }))
    expect(api.exports.openFolder).toHaveBeenCalledWith({ jobId: 'job-1' })
    api.exports.start.mockResolvedValueOnce(null)
    await userEvent.click(screen.getByRole('button', { name: 'markdown' }))
    expect(await screen.findByText('Export cancelled.')).toBeVisible()
    api.exports.start.mockRejectedValueOnce(new Error('Export unavailable'))
    await userEvent.click(screen.getByRole('button', { name: 'pdf' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Export unavailable')
  })
  it('cancels and retries an export, polls until completion and clears its timer', async () => {
    const clear = vi.spyOn(window, 'clearInterval')
    api.exports.start.mockResolvedValue(job('export-1', 'running'))
    api.jobs.cancel.mockResolvedValue(job('export-1', 'cancelled'))
    api.jobs.retry.mockResolvedValue(job('export-1', 'running'))
    api.jobs.get.mockResolvedValue(job('export-1', 'completed'))
    await exportPage()
    await userEvent.click(screen.getByRole('button', { name: 'markdown' }))
    expect(await screen.findByText('Exporting · 42%')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel export' }))
    expect(await screen.findByText('Export cancelled', { exact: true })).toBeVisible()
    expect(api.jobs.cancel).toHaveBeenCalledWith({ jobId: 'export-1' })
    await userEvent.click(screen.getByRole('button', { name: 'Retry export' }))
    expect(await screen.findByText('Export complete')).toBeVisible()
    expect(api.jobs.get).toHaveBeenCalledWith({ jobId: 'export-1' })
    expect(api.jobs.retry).toHaveBeenCalledWith({ jobId: 'export-1' })
    expect(clear).toHaveBeenCalled()
  })
  it('shows failed exports and routes folder-open errors', async () => {
    api.exports.start.mockResolvedValue(job('export-1', 'failed', { errorMessage: 'Disk full' }))
    await exportPage()
    await userEvent.click(screen.getByRole('button', { name: 'markdown' }))
    expect(await screen.findByText('Export failed')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full')
    api.jobs.retry.mockResolvedValue(job('export-1', 'completed'))
    await userEvent.click(screen.getByRole('button', { name: 'Retry export' }))
    api.exports.openFolder.mockRejectedValueOnce(new Error('Cannot open folder'))
    await userEvent.click(await screen.findByRole('button', { name: 'Open export folder' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot open folder')
  })
  it('shows empty and failed search states and selects notebook or paginated matches', async () => {
    render(<App />)
    await screen.findByRole('button', { name: 'Topic page' })
    await userEvent.click(screen.getByRole('button', { name: /Search pages, notes, and blocks/ }))
    const input = screen.getByPlaceholderText('Search pages, notes, and blocks…')
    fireEvent.change(input, { target: { value: 'none' } })
    expect(await screen.findByText('No matches.')).toBeVisible()
    api.search.mockRejectedValueOnce(new Error('Search unavailable'))
    fireEvent.change(input, { target: { value: 'failure' } })
    expect(await screen.findByText('Search failed. Edit the query to retry.')).toBeVisible()
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByText('Start typing to search pages, notes, and blocks.')).toBeVisible()
    api.search.mockResolvedValue([
      { entityType: 'notebook', entityId: 'notebook-1', title: 'Research match', notebookId: 'notebook-1', excerpt: '' }
    ])
    fireEvent.change(input, { target: { value: 'research' } })
    await userEvent.click(await screen.findByRole('button', { name: /Research match/ }))
    expect(await screen.findByRole('textbox', { name: 'Page title' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /Search pages, notes, and blocks/ }))
    api.search.mockResolvedValue([
      {
        entityType: 'note',
        entityId: 'note-99',
        title: 'Distant note',
        pageId: 'page-1',
        notePosition: 99,
        excerpt: 'needle'
      }
    ])
    fireEvent.change(screen.getByPlaceholderText('Search pages, notes, and blocks…'), { target: { value: 'needle' } })
    await userEvent.click(await screen.findByRole('button', { name: /Distant note/ }))
    expect(api.pages.getWorkspace).toHaveBeenLastCalledWith({ pageId: 'page-1', cursor: '98' })
  })
})
