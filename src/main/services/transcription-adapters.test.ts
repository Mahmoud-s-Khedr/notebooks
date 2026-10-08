import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import {
  OpenRouterProvider,
  WhisperCppProvider,
  WhisperModelManager,
  formatWhisperFailure
} from './transcription-service'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
let root: string
let audio: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adapter-test-'))
  audio = join(root, 'audio.wav')
  writeFileSync(audio, 'audio')
  vi.resetAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

describe('cloud transcription adapter', () => {
  it('sends multipart audio and normalizes timestamps, missing fields and confidence', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'Transcript',
        segments: [{ start: 0.123, end: 1.234, text: 'Words', avg_logprob: -1 }, {}]
      })
    })
    vi.stubGlobal('fetch', fetcher)
    const provider = new OpenRouterProvider(() => 'test-key')
    await expect(provider.transcribe({ audioPath: audio, model: 'whisper', language: 'en' })).resolves.toEqual({
      text: 'Transcript',
      segments: [
        { startMs: 123, endMs: 1234, text: 'Words', confidence: Math.exp(-1) },
        { startMs: 0, endMs: 0, text: '', confidence: undefined }
      ]
    })
    const [url, request] = fetcher.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions')
    expect(request.headers).toEqual({ Authorization: 'Bearer test-key' })
    expect(request.body.get('language')).toBe('en')
    expect(request.body.get('model')).toBe('whisper')
    expect(await request.body.get('file').text()).toBe('audio')
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'No segments' }) })
    await expect(provider.transcribe({ audioPath: audio, model: 'whisper' })).resolves.toEqual({
      text: 'No segments',
      segments: []
    })
    expect(fetcher.mock.calls[1][1].body.get('language')).toBeNull()
  })
  it('rejects missing keys, HTTP errors, invalid JSON payloads and network failures', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(new OpenRouterProvider(() => null).transcribe({ audioPath: audio, model: 'whisper' })).rejects.toThrow(
      'Configure an OpenRouter key'
    )
    expect(fetcher).not.toHaveBeenCalled()
    const provider = new OpenRouterProvider(() => 'test-key')
    fetcher.mockResolvedValueOnce({ ok: false, status: 401 })
    await expect(provider.transcribe({ audioPath: audio, model: 'whisper' })).rejects.toThrow('(401)')
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ text: 42 }) })
    await expect(provider.transcribe({ audioPath: audio, model: 'whisper' })).rejects.toThrow(
      'invalid transcription response'
    )
    fetcher.mockRejectedValueOnce(new Error('offline'))
    await expect(provider.transcribe({ audioPath: audio, model: 'whisper' })).rejects.toThrow('offline')
  })
})

describe('local process adapter', () => {
  const setup = () => {
    const binaryPath = join(root, 'whisper')
    const modelPath = join(root, 'model')
    writeFileSync(binaryPath, 'binary')
    writeFileSync(modelPath, 'model')
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() })
    vi.mocked(spawn).mockReturnValue(child as never)
    return { child, provider: new WhisperCppProvider(() => ({ binaryPath, modelPath })) }
  }
  const output = () => {
    const args = vi.mocked(spawn).mock.calls[0][1] as string[]
    return args[args.indexOf('-of') + 1]
  }
  it('requires the sidecar and model before spawning', async () => {
    for (const paths of [
      { binaryPath: null, modelPath: null },
      { binaryPath: audio, modelPath: null },
      { binaryPath: '/missing', modelPath: audio },
      { binaryPath: audio, modelPath: '/missing' }
    ])
      await expect(new WhisperCppProvider(() => paths).transcribe({ audioPath: audio, model: 'base' })).rejects.toThrow(
        'Local transcription is unavailable'
      )
    expect(spawn).not.toHaveBeenCalled()
  })
  it.each(['json', 'text-only', 'invalid-json', 'empty-json'])(
    'reads %s output and always removes temporary files',
    async (kind) => {
      const { child, provider } = setup()
      const progress = vi.fn()
      const pending = provider.transcribe({ audioPath: audio, model: 'base', language: 'ar', progress })
      const prefix = output()
      writeFileSync(`${prefix}.txt`, '  Spoken words  ')
      if (kind === 'json')
        writeFileSync(
          `${prefix}.json`,
          JSON.stringify({ transcription: [{ offsets: { from: -1, to: 100 }, text: 'words' }, {}] })
        )
      if (kind === 'invalid-json') writeFileSync(`${prefix}.json`, '{')
      if (kind === 'empty-json') writeFileSync(`${prefix}.json`, '{}')
      child.stderr.emit('data', Buffer.from('x'.repeat(1200) + '\nprogress = 5%\nprogress = 10%\nprogress = 5%'))
      child.emit('close', 0, null)
      const result = await pending
      expect(result.text).toBe('Spoken words')
      expect(result.segments).toEqual(
        kind === 'json'
          ? [
              { startMs: 0, endMs: 100, text: 'words' },
              { startMs: 0, endMs: 0, text: '' }
            ]
          : []
      )
      expect(progress.mock.calls).toEqual([[5], [10]])
      expect(vi.mocked(spawn).mock.calls[0][1]).toEqual(expect.arrayContaining(['-l', 'ar', '-pp']))
      expect(readdirSync(root).sort()).toEqual(['audio.wav', 'model', 'whisper'])
    }
  )
  it.each(['exit', 'error', 'unknown'] as const)('reports %s failure with redaction and cleanup', async (kind) => {
    const { child, provider } = setup()
    const pending = provider.transcribe({ audioPath: audio, model: 'base' })
    const rejection = expect(pending).rejects.toThrow(/Local Whisper could not transcribe/)
    writeFileSync(`${output()}.txt`, 'partial')
    if (kind === 'exit') {
      child.stderr.emit('data', Buffer.from('failed /private/model token=secret'))
      child.emit('close', 1, null)
    } else child.emit('error', kind === 'error' ? new Error('failed /private/audio') : 'unexpected failure')
    await rejection
    expect(readdirSync(root).sort()).toEqual(['audio.wav', 'model', 'whisper'])
  })
  it('escalates cancelled processes and clears timers after exit', async () => {
    vi.useFakeTimers()
    const { child, provider } = setup()
    let cancelled = false
    const pending = provider.transcribe({ audioPath: audio, model: 'base', cancelled: () => cancelled })
    const rejection = expect(pending).rejects.toThrow('Cancelled')
    await vi.advanceTimersByTimeAsync(75)
    expect(child.kill).not.toHaveBeenCalled()
    cancelled = true
    await vi.advanceTimersByTimeAsync(75)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    await vi.advanceTimersByTimeAsync(2000)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    child.emit('close', null, 'SIGKILL')
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves terminal diagnostics within the length limit', () => {
    expect(formatWhisperFailure('x'.repeat(1000), null, null)).toHaveLength(700)
    expect(formatWhisperFailure('', 1, null)).toBe('Whisper exited with code 1.')
    expect(formatWhisperFailure('', null, null)).toBe('Whisper exited with code unknown.')
  })
})

describe('model download boundaries', () => {
  it('reports missing binary, validates IDs, and removes models', () => {
    const manager = new WhisperModelManager(root, '/missing', vi.fn())
    expect(() => manager.path('bad')).toThrow('Unknown Whisper model')
    expect(manager.getStatus('ggml-tiny.bin')).toMatchObject({
      binaryPath: null,
      available: false,
      download: { state: 'idle' }
    })
    writeFileSync(manager.path('ggml-tiny.bin'), 'model')
    expect(manager.list()[0]).toMatchObject({ installed: true, state: 'ready' })
    manager.remove('ggml-tiny.bin')
    expect(manager.list()[0]).toMatchObject({ installed: false, state: 'idle' })
  })
  it.each([
    { ok: false, body: null },
    { ok: true, body: null }
  ])('rejects unavailable download responses', async (response) => {
    const manager = new WhisperModelManager(root, null, vi.fn().mockResolvedValue(response))
    await expect(manager.download('ggml-tiny.bin')).rejects.toThrow('could not be downloaded')
    expect(manager.getStatus('ggml-tiny.bin').download).toMatchObject({ state: 'failed', progress: null })
    expect(readdirSync(root)).toEqual(['audio.wav'])
  })
  it('streams chunks, checks integrity and removes incomplete files', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
      .mockResolvedValueOnce({ done: true })
    const cancel = vi.fn().mockResolvedValue(undefined)
    const releaseLock = vi.fn()
    const manager = new WhisperModelManager(
      root,
      audio,
      vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => ({ read, cancel, releaseLock }) } })
    )
    const progress = vi.fn()
    await expect(manager.download('ggml-tiny.bin', () => false, progress)).rejects.toThrow('integrity check')
    expect(progress).toHaveBeenCalledWith((3 / 77691713) * 100)
    expect(cancel).toHaveBeenCalledOnce()
    expect(releaseLock).toHaveBeenCalledOnce()
    expect(manager.getStatus('ggml-tiny.bin').binaryPath).toBe(audio)
    expect(readdirSync(root)).toEqual(['audio.wav'])
  })
  it('cancels without fetching, and skips already installed models', async () => {
    const fetcher = vi.fn()
    const manager = new WhisperModelManager(root, null, fetcher)
    await expect(manager.download('ggml-tiny.bin', () => true)).rejects.toThrow('Cancelled')
    expect(manager.getStatus('ggml-tiny.bin').download).toMatchObject({ state: 'idle', error: null })
    expect(fetcher).not.toHaveBeenCalled()
    writeFileSync(manager.path('ggml-tiny.bin'), 'installed')
    await manager.download('ggml-tiny.bin')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
