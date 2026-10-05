import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { TestLibrary, validWav } from '../test-support'
import {
  formatWhisperFailure,
  localWhisperEnvironment,
  redactWhisperDiagnostic,
  TranscriptionService,
  whisperProgressUpdates,
  type TranscriptionProvider
} from './transcription-service'
import { JobService } from './job-service'

describe('TranscriptionService disk state recovery', () => {
  const libraries: TestLibrary[] = []
  afterEach(() => libraries.splice(0).forEach((library) => library.close()))

  const audioFixture = () => {
    const library = new TestLibrary()
    libraries.push(library)
    const notebook = library.service.createNotebook('Audio')
    const page = library.service.createPage(notebook.id, 'Page')
    const note = library.service.createNote(page.id, 'Note')
    const block = library.service.saveRecording(note.id, validWav().toString('base64'))
    return { library, block }
  }
  const transcriber = (library: TestLibrary, provider: TranscriptionProvider) =>
    new TranscriptionService(
      library.database.connection,
      (relative) => `${library.assets}/${relative.replace(/^assets\//, '')}`,
      { local: provider, openrouter: provider },
      () => ({
        openRouterConfigured: false,
        localModels: [],
        openRouterModels: [],
        localBinaryAvailable: false,
        localModelAvailable: false,
        selectedLocalModel: null,
        localDownload: { state: 'idle', progress: null, error: null }
      })
    )

  it('makes bundled Linux Whisper libraries discoverable without discarding existing paths', () => {
    expect(
      localWhisperEnvironment('/opt/research/whisper-cli', { LD_LIBRARY_PATH: '/usr/local/lib' }, 'linux')
    ).toEqual({
      LD_LIBRARY_PATH: '/opt/research:/usr/local/lib'
    })
    expect(localWhisperEnvironment('C:\\Research\\whisper-cli.exe', { Path: 'existing' }, 'win32')).toEqual({
      Path: 'existing'
    })
  })

  it('keeps the terminal Whisper diagnostic and reports a sidecar signal without leaking secrets', () => {
    const diagnostic = [
      'whisper_init_with_params_no_state: use gpu = 1',
      'loading model at /private/audio/ggml-small.bin token=do-not-save',
      'ggml backend crashed'
    ].join('\n')
    const failure = formatWhisperFailure(diagnostic, null, 'SIGILL')
    expect(failure).toContain('ggml backend crashed')
    expect(failure).toContain('Whisper was terminated by SIGILL.')
    expect(failure).not.toContain('/private')
    expect(failure).not.toContain('do-not-save')
    expect(redactWhisperDiagnostic('spawn /private/audio.wav Bearer secret-value')).toBe(
      'spawn [path redacted] [redacted]'
    )
  })

  it('extracts only forward Whisper CLI progress updates from stderr', () => {
    const output = [
      'whisper_print_progress_callback: progress =   5%',
      'whisper_print_progress_callback: progress =  10%',
      'whisper_print_progress_callback: progress =  10%',
      'whisper_print_progress_callback: progress = 105%'
    ].join('\n')
    expect(whisperProgressUpdates(output)).toEqual([5, 10])
    expect(whisperProgressUpdates(output, 5)).toEqual([10])
  })

  it('persists completed, failed, cancelled, and retried runs without secrets or audio paths', async () => {
    const { library, block } = audioFixture()
    const complete: TranscriptionProvider = {
      name: 'openrouter',
      transcribe: async () => ({
        text: 'hello world',
        confidence: 0.9,
        segments: [{ startMs: 0, endMs: 100, text: 'hello world' }]
      })
    }
    const service = transcriber(library, complete)
    const finished = await service.execute(service.create(block.id, 'openrouter', 'fixture-model').id)
    expect(finished).toMatchObject({ status: 'completed', transcriptText: 'hello world' })
    expect(finished.segments).toHaveLength(1)

    const failing = transcriber(library, {
      name: 'openrouter',
      transcribe: async () => {
        throw new Error('failed /private/audio.wav token=top-secret sk-secret-value')
      }
    })
    const failed = await failing.execute(failing.create(block.id, 'openrouter', 'fixture-model').id)
    expect(failed.status).toBe('failed')
    expect(failed.errorMessage).toContain('[redacted]')
    expect(failed.errorMessage).not.toContain('private')
    expect(failed.errorMessage).not.toContain('top-secret')

    const cancelled = transcriber(library, {
      name: 'openrouter',
      transcribe: async () => ({ text: 'late', segments: [] })
    })
    const cancelledRun = await cancelled.execute(
      cancelled.create(block.id, 'openrouter', 'fixture-model').id,
      () => true
    )
    expect(cancelledRun.status).toBe('cancelled')
    const retry = await service.retry(failed.id)
    expect(retry.status).toBe('completed')
    expect(retry.id).not.toBe(failed.id)
  })

  it('marks restart-interrupted background work failed and keeps queued work recoverable', () => {
    const { library } = audioFixture()
    const started = new Date().toISOString()
    const id = randomUUID()
    library.database.connection
      .prepare(
        "INSERT INTO jobs (id,kind,status,payload_json,created_at,started_at,updated_at) VALUES (?,'transcription','running','{}',?,?,?)"
      )
      .run(id, started, started, started)
    const jobs = new JobService(library.database.connection)
    expect(jobs.get(id)).toMatchObject({
      status: 'failed',
      errorMessage: 'Interrupted by application restart; retry this job.'
    })
  })
})
