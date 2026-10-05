import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioRecorder } from './PageWorkspace'
import { SaveContext, SaveCoordinator } from '../../save-coordinator'
import { installResearchNotebookApi } from '../../test/support'

const track = { stop: vi.fn(), onmute: null, onunmute: null, onended: null }
const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
class FakeAudioContext {
  destination = {}
  createScriptProcessor() {
    return { ...node(), onaudioprocess: null }
  }
  createMediaStreamSource() {
    return node()
  }
  createAnalyser() {
    return { ...node(), fftSize: 512, getByteTimeDomainData: (values: Uint8Array) => values.fill(128) }
  }
  resume = async () => undefined
  close = async () => undefined
}
describe('recording persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }) }
    })
  })
  it('retains the original note and WAV on failure, then retries once', async () => {
    const api = installResearchNotebookApi()
    const saves = new SaveCoordinator()
    api.assets.saveRecording.mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue({})
    const view = render(
      <SaveContext.Provider value={saves}>
        <AudioRecorder noteId="first" onSaved={vi.fn()} onError={vi.fn()} />
      </SaveContext.Provider>
    )
    await saves.recorder!.start('first')
    view.rerender(
      <SaveContext.Provider value={saves}>
        <AudioRecorder noteId="second" onSaved={vi.fn()} onError={vi.fn()} />
      </SaveContext.Provider>
    )
    await expect(saves.flush()).rejects.toThrow('Disk full')
    expect(await screen.findByRole('button', { name: 'Retry save' })).toBeVisible()
    const captured = api.assets.saveRecording.mock.calls[0][0]
    await Promise.all([saves.flush(), saves.flush()])
    expect(api.assets.saveRecording).toHaveBeenCalledTimes(2)
    expect(api.assets.saveRecording.mock.calls[1][0]).toEqual(captured)
    expect(captured.noteId).toBe('first')
    expect(atob(captured.wavBase64).slice(0, 4)).toBe('RIFF')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry save' })).not.toBeInTheDocument())
  })
  it('reports denied microphone permission and remains usable', async () => {
    installResearchNotebookApi()
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(new Error('Permission denied'))
    const saves = new SaveCoordinator()
    render(
      <SaveContext.Provider value={saves}>
        <AudioRecorder noteId="first" onSaved={vi.fn()} onError={vi.fn()} />
      </SaveContext.Provider>
    )
    await expect(saves.recorder!.start('first')).rejects.toThrow('Permission denied')
    await expect(saves.flush()).resolves.toBeUndefined()
  })
})

it('keeps a pending recording save shared and rejects a new recording until it commits', async () => {
  const api = installResearchNotebookApi()
  const saves = new SaveCoordinator()
  vi.stubGlobal('AudioContext', FakeAudioContext)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }) }
  })
  let commit!: (value: unknown) => void
  api.assets.saveRecording.mockImplementation(
    () =>
      new Promise((resolve) => {
        commit = resolve
      })
  )
  render(
    <SaveContext.Provider value={saves}>
      <AudioRecorder noteId="first" onSaved={vi.fn()} onError={vi.fn()} />
    </SaveContext.Provider>
  )
  await saves.recorder!.start('first')
  const first = saves.flush()
  const simultaneous = saves.flush()
  await waitFor(() => expect(api.assets.saveRecording).toHaveBeenCalledTimes(1))
  await expect(saves.recorder!.start('second')).rejects.toThrow('Save the current recording')
  commit({})
  await Promise.all([first, simultaneous])
  expect(api.assets.saveRecording).toHaveBeenCalledTimes(1)
})
