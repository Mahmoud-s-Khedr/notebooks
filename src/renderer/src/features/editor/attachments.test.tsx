import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PageWorkspace } from './PageWorkspace'
import { block, note, workspace, installResearchNotebookApi } from '../../test/support'

let api: ReturnType<typeof installResearchNotebookApi>
beforeEach(() => {
  api = installResearchNotebookApi()
})
const setup = (blocks = [block({ type: 'audio', data: { assetId: 'asset-1' } })]) => {
  const onError = vi.fn()
  const view = render(
    <PageWorkspace
      workspace={workspace({ notes: [{ ...note(), blocks }] })}
      notebookId="notebook-1"
      mode="write"
      activeNoteId="note-1"
      reloadWorkspace={vi.fn()}
      loadMore={vi.fn()}
      setActiveNoteId={vi.fn()}
      onError={onError}
      onChanged={vi.fn()}
      onTrashed={vi.fn()}
      onViewSource={vi.fn()}
      onUtilities={vi.fn()}
    />
  )
  return { ...view, onError }
}
const run = (status: string, extra = {}) => ({
  id: 'run-1',
  blockId: 'block-1',
  provider: 'local',
  model: 'tiny',
  status,
  errorMessage: null,
  transcriptText: 'Spoken words',
  createdAt: '2026-10-04',
  segments: [],
  ...extra
})

describe('attachment and transcription interactions', () => {
  it('switches between review and source segments without showing both', async () => {
    api.transcription.list.mockResolvedValue([
      run('completed', { segments: [{ id: 'segment-1', startMs: 6000, endMs: 9000, text: 'Original words' }] })
    ])
    setup()
    await waitFor(() => expect(screen.getByLabelText('Reviewed transcript')).toHaveValue('Spoken words'))
    expect(screen.queryByRole('button', { name: 'Play segment at 6 seconds' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Transcript run' })).not.toBeInTheDocument()
    expect(screen.queryByText('local · tiny · completed')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Segments' }))
    expect(await screen.findByRole('button', { name: 'Play segment at 6 seconds' })).toHaveTextContent('0:06')
    expect(screen.queryByLabelText('Reviewed transcript')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Transcript' }))
    expect(screen.getByLabelText('Reviewed transcript')).toHaveValue('Spoken words')
    expect(screen.queryByText('Original words')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse transcript' }))
    await waitFor(() => expect(screen.getByLabelText('Reviewed transcript')).not.toBeVisible())
    expect(screen.getByRole('button', { name: 'Expand transcript' })).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Expand transcript' }))
    await waitFor(() => expect(screen.getByLabelText('Reviewed transcript')).toBeVisible())
  })
  it('shows missing references and loads file and image data with exact asset IDs', async () => {
    api.assets.dataUrl.mockResolvedValue('data:text/plain;base64,aGVsbG8=')
    api.assets.thumbnailDataUrl.mockResolvedValue('data:image/png;base64,cHJldmlldw==')
    setup([
      block({ id: 'missing', type: 'file', data: {} }),
      block({ id: 'file', type: 'file', data: { assetId: 'file-id', filename: 'notes.txt' } }),
      block({ id: 'image', type: 'image', data: { assetId: 'image-id', filename: 'photo.png' } })
    ])
    expect(screen.getByText('Missing asset reference.')).toBeVisible()
    const link = await screen.findByRole('link', { name: 'Download attached file' })
    expect(link).toHaveAttribute('download', 'notes.txt')
    expect(link).toHaveAttribute('href', 'data:text/plain;base64,aGVsbG8=')
    expect(await screen.findByRole('img', { name: 'photo.png' })).toHaveAttribute(
      'src',
      'data:image/png;base64,cHJldmlldw=='
    )
    expect(api.assets.thumbnailDataUrl).toHaveBeenCalledWith({ assetId: 'image-id', width: 800, height: 600 })
    api.assets.dataUrl.mockResolvedValue('data:image/png;base64,b3JpZ2luYWw=')
    await userEvent.click(screen.getByRole('button', { name: 'Open full-resolution image: photo.png' }))
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute(
        'src',
        'data:image/png;base64,b3JpZ2luYWw='
      )
    )
    expect(api.assets.dataUrl).toHaveBeenCalledWith({ assetId: 'image-id' })
  })
  it('requests missing thumbnails and reports attachment loading failures', async () => {
    api.assets.requestThumbnail.mockRejectedValueOnce(new Error('Thumbnail unavailable'))
    const { onError } = setup([block({ type: 'image', data: { assetId: 'asset-1' } })])
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Thumbnail unavailable' }))
    )
    api.assets.dataUrl.mockRejectedValueOnce(new Error('Asset missing'))
    await userEvent.click(screen.getByRole('button', { name: 'Load image' }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Asset missing' })))
  })
  it.each([
    [{ localBinaryAvailable: false }, 'Whisper runtime is missing.'],
    [{ localBinaryAvailable: true, localModelAvailable: false }, 'Download and select a local model in Settings.']
  ])('disables local transcription until prerequisites are met (%s)', async (settings, message) => {
    api.settings.transcription.mockResolvedValue(settings)
    setup()
    expect(await screen.findByText(new RegExp(message.replace(/\./g, '\\.')))).toBeVisible()
    expect(screen.getByRole('button', { name: 'Transcribe' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Transcription provider'), { target: { value: 'openrouter' } })
    expect(await screen.findByText('Configure an OpenRouter key in Settings.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Transcribe' })).toBeDisabled()
  })
  it('starts local transcription with a language hint and displays job progress', async () => {
    api.settings.transcription.mockResolvedValue({
      localBinaryAvailable: true,
      localModelAvailable: true,
      selectedLocalModel: { displayName: 'Tiny' }
    })
    api.transcription.create.mockResolvedValue({ id: 'job-1', transcriptionRunId: 'run-1' })
    setup()
    expect(await screen.findByText('Local runtime ready · Tiny')).toBeVisible()
    api.transcription.list.mockResolvedValue([run('running')])
    api.jobs.list.mockResolvedValue([{ transcriptionRunId: 'run-1', progress: 37 }])
    fireEvent.change(screen.getByLabelText('Language hint'), { target: { value: 'ar' } })
    await userEvent.click(screen.getByRole('button', { name: 'Transcribe' }))
    expect(api.transcription.create).toHaveBeenCalledWith({ blockId: 'block-1', provider: 'local', language: 'ar' })
    expect(await screen.findByText('local · tiny · running · 37%')).toBeVisible()
  })
  it('starts cloud transcription without a language hint and reports errors', async () => {
    api.settings.transcription.mockResolvedValue({ openRouterConfigured: true })
    const { onError } = setup()
    fireEvent.change(screen.getByLabelText('Transcription provider'), { target: { value: 'openrouter' } })
    expect(await screen.findByText(/Audio is sent to OpenRouter/)).toBeVisible()
    api.transcription.create.mockResolvedValue({ id: 'run-1' })
    await userEvent.click(screen.getByRole('button', { name: 'Transcribe' }))
    expect(api.transcription.create).toHaveBeenCalledWith({
      blockId: 'block-1',
      provider: 'openrouter',
      language: undefined
    })
    api.transcription.create.mockRejectedValueOnce(new Error('Cloud unavailable'))
    await userEvent.click(screen.getByRole('button', { name: 'Transcribe' }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cloud unavailable' })))
  })
  it.each(['failed', 'cancelled'])('retries a %s run and renders the new result', async (status) => {
    api.transcription.list.mockResolvedValue([run(status, { errorMessage: 'Recognition interrupted' })])
    api.transcription.retry.mockResolvedValue({ id: 'job-2', transcriptionRunId: 'run-2' })
    setup()
    expect(await screen.findByText('Recognition interrupted')).toBeVisible()
    api.transcription.list.mockResolvedValue([run('completed', { id: 'run-2' })])
    await userEvent.click(screen.getByRole('button', { name: 'Retry transcription' }))
    expect(api.transcription.retry).toHaveBeenCalledWith({ runId: 'run-1' })
    expect(await screen.findByLabelText('Reviewed transcript')).toHaveValue('Spoken words')
  })
})
