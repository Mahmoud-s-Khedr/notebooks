import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import type Database from 'better-sqlite3'
import type {
  TranscriptionProviderName,
  TranscriptionRun,
  TranscriptionSegment,
  TranscriptionSettings,
  TranscriptionStatus,
  WhisperModel
} from '../../shared/domain'

export interface NormalizedTranscript {
  text: string
  confidence?: number
  segments: Array<{ startMs: number; endMs: number; text: string; confidence?: number }>
}
export interface TranscriptionProvider {
  readonly name: TranscriptionProviderName
  transcribe(input: {
    audioPath: string
    model: string
    language?: string
    cancelled?: () => boolean
    progress?: (value: number) => void
  }): Promise<NormalizedTranscript>
}
export interface LocalModelStatus {
  binaryPath: string | null
  modelPath: string
  available: boolean
  download: { state: 'idle' | 'downloading' | 'ready' | 'failed'; progress: number | null; error: string | null }
}

/**
 * Linux packages the whisper.cpp shared objects next to the CLI. The dynamic
 * linker does not look beside an executable by default, so retain any caller
 * library paths while placing that bundled directory first.
 */
export function localWhisperEnvironment(
  binaryPath: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  if (platform !== 'linux') return environment
  const libraryPath = [dirname(binaryPath), environment.LD_LIBRARY_PATH].filter(Boolean).join(delimiter)
  return { ...environment, LD_LIBRARY_PATH: libraryPath }
}

/**
 * The sidecar writes its useful failure reason last (after its configuration
 * banner). Keep that end of the diagnostic so a model-load error or crash is
 * not hidden behind routine "use gpu" output. Redaction happens before the
 * length limit, so neither paths nor credentials can leak into job history.
 */
export function redactWhisperDiagnostic(diagnostic: string): string {
  return diagnostic
    .replace(/(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+|(?:api[_-]?key|token|authorization)\s*[=:]\s*\S+)/gi, '[redacted]')
    .replace(/(?:[A-Za-z]:)?[/\\][^\s]+/g, '[path redacted]')
    .replace(/\r/g, '')
    .trim()
}

export function formatWhisperFailure(diagnostic: string, code: number | null, signal: NodeJS.Signals | null): string {
  const cleaned = redactWhisperDiagnostic(diagnostic)
  const exit = signal ? `Whisper was terminated by ${signal}.` : `Whisper exited with code ${code ?? 'unknown'}.`
  const detail = [cleaned, exit].filter(Boolean).join('\n')
  // Limit the persisted UI error, but preserve the terminal lines where
  // whisper.cpp reports the actual loader/model failure.
  return detail.length > 700 ? `…${detail.slice(-699)}` : detail
}

/** Extract monotonically increasing progress updates from whisper.cpp CLI stderr. */
export function whisperProgressUpdates(output: string, after = 0): number[] {
  const updates: number[] = []
  let latest = after
  for (const match of output.matchAll(/\bprogress\s*=\s*(\d{1,3})%/g)) {
    const value = Number(match[1])
    if (Number.isFinite(value) && value > latest && value <= 100) {
      updates.push(value)
      latest = value
    }
  }
  return updates
}

/** Downloads are deliberately owned by main process; no renderer path or URL access is exposed. */
export class WhisperModelManager {
  // These are the multilingual ggml release artifacts. The revision is pinned so a
  // changed upstream branch can never silently replace a model.
  static readonly catalog = [
    {
      id: 'ggml-tiny.bin',
      displayName: 'Whisper Tiny (multilingual)',
      sizeBytes: 77_691_713,
      sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21'
    },
    {
      id: 'ggml-base.bin',
      displayName: 'Whisper Base (multilingual)',
      sizeBytes: 147_951_465,
      sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
    },
    {
      id: 'ggml-small.bin',
      displayName: 'Whisper Small (multilingual)',
      sizeBytes: 487_601_967,
      sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
    },
    {
      id: 'ggml-medium.bin',
      displayName: 'Whisper Medium (multilingual)',
      sizeBytes: 1_533_763_059,
      sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208'
    },
    {
      id: 'ggml-large-v3.bin',
      displayName: 'Whisper Large-v3 (multilingual)',
      sizeBytes: 3_095_033_483,
      sha256: '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2'
    }
  ] as const
  private readonly status = new Map<string, LocalModelStatus['download']>()
  constructor(
    private readonly directory: string,
    private readonly binaryPath: string | null,
    private readonly fetcher: typeof fetch = fetch
  ) {
    mkdirSync(directory, { recursive: true })
  }
  path(modelId: string): string {
    this.model(modelId)
    return join(this.directory, modelId)
  }
  getStatus(modelId: string): LocalModelStatus {
    const available = existsSync(this.path(modelId))
    return {
      binaryPath: this.binaryPath && existsSync(this.binaryPath) ? this.binaryPath : null,
      modelPath: this.path(modelId),
      available,
      download: available
        ? { state: 'ready', progress: 1, error: null }
        : (this.status.get(modelId) ?? { state: 'idle', progress: null, error: null })
    }
  }
  list(): WhisperModel[] {
    return WhisperModelManager.catalog.map((model) => ({
      ...model,
      installed: existsSync(this.path(model.id)),
      ...this.getStatus(model.id).download
    }))
  }
  async download(
    modelId: string,
    cancelled: () => boolean = () => false,
    progress: (value: number) => void = () => {}
  ): Promise<void> {
    const model = this.model(modelId)
    if (existsSync(this.path(modelId))) return
    this.status.set(modelId, { state: 'downloading', progress: 0, error: null })
    const temporary = `${this.path(modelId)}.${randomUUID()}.tmp`
    try {
      const response = await this.fetcher(
        `https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/${model.id}`
      )
      if (!response.ok || !response.body) throw new Error('The multilingual Whisper model could not be downloaded.')
      const length = Number(response.headers.get('content-length') ?? 0)
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      for (;;) {
        if (cancelled()) throw new Error('Cancelled')
        const next = await reader.read()
        if (next.done) break
        chunks.push(next.value)
        received += next.value.byteLength
        const value = length ? received / length : null
        this.status.set(modelId, { state: 'downloading', progress: value, error: null })
        progress(value === null ? 0 : value * 100)
      }
      const bytes = Buffer.concat(chunks)
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (hash !== model.sha256) throw new Error('The downloaded Whisper model failed its integrity check.')
      writeFileSync(temporary, bytes, { mode: 0o600 })
      if (cancelled()) throw new Error('Cancelled')
      renameSync(temporary, this.path(modelId))
      this.status.set(modelId, { state: 'ready', progress: 1, error: null })
      progress(100)
    } catch (error) {
      const message = safeError(error)
      rmSync(temporary, { force: true })
      this.status.set(modelId, {
        state: message === 'Cancelled' ? 'idle' : 'failed',
        progress: null,
        error: message === 'Cancelled' ? null : message
      })
      throw new Error(message)
    }
  }
  remove(modelId: string): void {
    rmSync(this.path(modelId), { force: true })
    this.status.set(modelId, { state: 'idle', progress: null, error: null })
  }
  private model(modelId: string) {
    const model = WhisperModelManager.catalog.find((candidate) => candidate.id === modelId)
    if (!model) throw new Error('Unknown Whisper model.')
    return model
  }
}

type RunRow = {
  id: string
  asset_id: string
  block_id: string
  provider: TranscriptionProviderName
  model: string
  language: string | null
  duration_ms: number | null
  status: TranscriptionStatus
  confidence: number | null
  transcript_text: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}
const time = () => new Date().toISOString()
const safeError = (error: unknown): string => {
  const value = error instanceof Error ? error.message : 'Transcription failed.'
  return value
    .replace(/(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+|(?:api[_-]?key|token|authorization)\s*[=:]\s*\S+)/gi, '[redacted]')
    .replace(/(?:[A-Za-z]:)?[/\\][^\s]+/g, '[path redacted]')
    .slice(0, 500)
}

export class OpenRouterProvider implements TranscriptionProvider {
  readonly name = 'openrouter' as const
  constructor(private readonly key: () => string | null) {}
  async transcribe(input: { audioPath: string; model: string; language?: string }): Promise<NormalizedTranscript> {
    const key = this.key()
    if (!key) throw new Error('Configure an OpenRouter key before using cloud transcription.')
    const body = new FormData()
    body.set('model', input.model)
    if (input.language) body.set('language', input.language)
    body.set('file', new Blob([readFileSync(input.audioPath)], { type: 'audio/wav' }), 'recording.wav')
    const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body
    })
    if (!response.ok) throw new Error(`OpenRouter transcription failed (${response.status}).`)
    const payload = (await response.json()) as {
      text?: unknown
      segments?: Array<{ start?: number; end?: number; text?: unknown; avg_logprob?: number }>
    }
    if (typeof payload.text !== 'string') throw new Error('OpenRouter returned an invalid transcription response.')
    return {
      text: payload.text,
      segments: (payload.segments ?? []).map((segment) => ({
        startMs: Math.round((segment.start ?? 0) * 1000),
        endMs: Math.round((segment.end ?? 0) * 1000),
        text: typeof segment.text === 'string' ? segment.text : '',
        confidence: segment.avg_logprob === undefined ? undefined : Math.exp(segment.avg_logprob)
      }))
    }
  }
}

/** A small adapter for packaged whisper.cpp binaries. The binary path is intentionally injected. */
export class WhisperCppProvider implements TranscriptionProvider {
  readonly name = 'local' as const
  constructor(private readonly paths: () => { binaryPath: string | null; modelPath: string | null }) {}
  async transcribe(input: {
    audioPath: string
    model: string
    language?: string
    cancelled?: () => boolean
    progress?: (value: number) => void
  }): Promise<NormalizedTranscript> {
    const paths = this.paths()
    if (!paths.binaryPath || !paths.modelPath || !existsSync(paths.binaryPath) || !existsSync(paths.modelPath))
      throw new Error(
        'Local transcription is unavailable. Install the bundled Whisper sidecar and download the multilingual model.'
      )
    const binaryPath = paths.binaryPath
    const modelPath = paths.modelPath
    const output = `${input.audioPath}.${randomUUID()}.txt`
    // whisper.cpp only emits its percentage callbacks when explicitly asked. Those
    // callbacks arrive on stderr and feed the persistent job's checkpoints below.
    const args = ['-m', modelPath, '-f', input.audioPath, '-otxt', '-oj', '-pp', '-of', output.replace(/\.txt$/, '')]
    if (input.language) args.push('-l', input.language)
    let child: ReturnType<typeof spawn> | null = null
    let stderr = ''
    let reportedProgress = 0
    try {
      await new Promise<void>((resolveRun, rejectRun) => {
        child = spawn(binaryPath, args, {
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: localWhisperEnvironment(binaryPath)
        })
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8')
          if (stderr.length > 1000) stderr = stderr.slice(-1000)
          // Current whisper.cpp CLI output is:
          // "whisper_print_progress_callback: progress =   5%".
          // Read all matches because a single stderr chunk can contain multiple
          // progress updates, and ignore a repeated/older value defensively.
          for (const value of whisperProgressUpdates(stderr, reportedProgress)) {
            reportedProgress = value
            input.progress?.(value)
          }
        })
        let terminated = false
        const timer = setInterval(() => {
          if (!input.cancelled?.() || !child || terminated) return
          terminated = true
          child.kill('SIGTERM')
          setTimeout(() => {
            if (child && !child.killed) child.kill('SIGKILL')
          }, 2000).unref()
        }, 75)
        child.once('error', (error) => {
          clearInterval(timer)
          rejectRun(error)
        })
        child.once('close', (code, signal) => {
          clearInterval(timer)
          if (input.cancelled?.()) rejectRun(new Error('Cancelled'))
          else if (code === 0) resolveRun()
          else rejectRun(new Error(formatWhisperFailure(stderr, code, signal)))
        })
      })
    } catch (error) {
      rmSync(output, { force: true })
      rmSync(output.replace(/\.txt$/, '.json'), { force: true })
      if (input.cancelled?.()) throw new Error('Cancelled')
      const detail =
        error instanceof Error ? redactWhisperDiagnostic(error.message).replace(/\n/g, ' ').slice(-700) : ''
      throw new Error(
        detail
          ? `Local Whisper could not transcribe this recording: ${detail}`
          : 'Local Whisper could not transcribe this recording. Check that the WAV is supported and try again.'
      )
    }
    const text = readFileSync(output, 'utf8').trim()
    const jsonPath = output.replace(/\.txt$/, '.json')
    let segments: NormalizedTranscript['segments'] = []
    try {
      const payload = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
        transcription?: Array<{ offsets?: { from?: number; to?: number }; text?: string }>
      }
      segments = (payload.transcription ?? []).map((segment) => ({
        startMs: Math.max(0, segment.offsets?.from ?? 0),
        endMs: Math.max(0, segment.offsets?.to ?? 0),
        text: segment.text ?? ''
      }))
    } catch {
      /* older sidecars only produce text */
    }
    return { text, segments }
  }
}

export class TranscriptionService {
  constructor(
    private readonly db: Database.Database,
    private readonly audioPath: (relativePath: string) => string,
    private readonly providers: Record<TranscriptionProviderName, TranscriptionProvider>,
    private readonly settings: () => TranscriptionSettings
  ) {}
  create(blockId: string, provider: TranscriptionProviderName, model: string, language?: string): TranscriptionRun {
    const asset = this.db
      .prepare(
        `SELECT a.id, a.relative_path, b.data_json FROM blocks b JOIN asset_references ar ON ar.block_id = b.id JOIN assets a ON a.id = ar.asset_id WHERE b.id = ? AND b.type = 'audio'`
      )
      .get(blockId) as { id: string; relative_path: string; data_json: string } | undefined
    if (!asset || !asset.relative_path.endsWith('.wav'))
      throw new Error('This audio block needs a retained WAV recording before it can be transcribed.')
    if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) throw new Error('The transcription model identifier is invalid.')
    if (language && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) throw new Error('The language hint is invalid.')
    const created = time()
    const id = randomUUID()
    this.db
      .prepare(
        'INSERT INTO transcription_runs (id, asset_id, block_id, provider, model, language, duration_ms, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        id,
        asset.id,
        blockId,
        provider,
        model,
        language ?? null,
        this.wavDuration(this.audioPath(asset.relative_path)),
        'queued',
        created,
        created
      )
    this.db
      .prepare(
        "UPDATE blocks SET data_json = json_set(data_json, '$.activeTranscriptionRunId', ?), updated_at = ? WHERE id = ?"
      )
      .run(id, created, blockId)
    return this.get(id)
  }
  async execute(
    runId: string,
    cancelled: () => boolean = () => false,
    progress: (value: number) => void = () => {}
  ): Promise<TranscriptionRun> {
    const row = this.row(runId)
    const path = this.db.prepare('SELECT relative_path FROM assets WHERE id = ?').get(row.asset_id) as {
      relative_path: string
    }
    const started = time()
    this.db
      .prepare(
        "UPDATE transcription_runs SET status = 'running', started_at = ?, error_message = NULL, updated_at = ? WHERE id = ?"
      )
      .run(started, started, runId)
    try {
      const output = await this.providers[row.provider].transcribe({
        audioPath: this.audioPath(path.relative_path),
        model: row.model,
        language: row.language ?? undefined,
        cancelled,
        progress
      })
      if (cancelled()) throw new Error('Cancelled')
      const completed = time()
      this.db.transaction(() => {
        this.db
          .prepare(
            "UPDATE transcription_runs SET status = 'completed', transcript_text = ?, confidence = ?, completed_at = ?, updated_at = ? WHERE id = ?"
          )
          .run(output.text, output.confidence ?? null, completed, completed, runId)
        const insert = this.db.prepare(
          'INSERT INTO transcription_segments (id, run_id, position, start_ms, end_ms, text, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        output.segments.forEach((s, position) =>
          insert.run(
            randomUUID(),
            runId,
            position,
            Math.max(0, s.startMs),
            Math.max(s.startMs, s.endMs),
            s.text,
            s.confidence ?? null
          )
        )
      })()
    } catch (error) {
      const completed = time()
      if (cancelled())
        this.db
          .prepare(
            "UPDATE transcription_runs SET status = 'cancelled', error_message = NULL, completed_at = ?, updated_at = ? WHERE id = ?"
          )
          .run(completed, completed, runId)
      else
        this.db
          .prepare(
            "UPDATE transcription_runs SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?"
          )
          .run(safeError(error), completed, completed, runId)
    }
    return this.get(runId)
  }
  async retry(runId: string): Promise<TranscriptionRun> {
    const prior = this.row(runId)
    const run = this.create(prior.block_id, prior.provider, prior.model, prior.language ?? undefined)
    return this.execute(run.id)
  }
  get(runId: string): TranscriptionRun {
    const row = this.row(runId)
    const segments = this.db
      .prepare('SELECT * FROM transcription_segments WHERE run_id = ? ORDER BY position')
      .all(runId) as Array<{
      id: string
      position: number
      start_ms: number
      end_ms: number
      text: string
      confidence: number | null
    }>
    return {
      id: row.id,
      assetId: row.asset_id,
      blockId: row.block_id,
      provider: row.provider,
      model: row.model,
      language: row.language,
      durationMs: row.duration_ms,
      status: row.status,
      confidence: row.confidence,
      transcriptText: row.transcript_text,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      segments: segments.map((s): TranscriptionSegment => ({
        id: s.id,
        position: s.position,
        startMs: s.start_ms,
        endMs: s.end_ms,
        text: s.text,
        confidence: s.confidence
      }))
    }
  }
  list(blockId: string): TranscriptionRun[] {
    return (
      this.db
        .prepare('SELECT id FROM transcription_runs WHERE block_id = ? ORDER BY created_at DESC')
        .all(blockId) as Array<{ id: string }>
    ).map(({ id }) => this.get(id))
  }
  getSettings(): TranscriptionSettings {
    return this.settings()
  }
  private row(id: string): RunRow {
    const row = this.db.prepare('SELECT * FROM transcription_runs WHERE id = ?').get(id) as RunRow | undefined
    if (!row) throw new Error('Transcription run does not exist.')
    return row
  }
  private wavDuration(path: string): number | null {
    try {
      const data = readFileSync(path)
      if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') return null
      const rate = data.readUInt32LE(24)
      const bytesPerSecond = data.readUInt32LE(28)
      const size = data.readUInt32LE(40)
      return rate && bytesPerSecond ? Math.round((size / bytesPerSecond) * 1000) : null
    } catch {
      return null
    }
  }
}

export class TranscriptionConfig {
  private readonly path: string
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true })
    this.path = join(directory, 'transcription.json')
  }
  private read(): {
    openRouterKey?: string
    selectedLocalModel?: string
    theme?: 'light' | 'dark' | 'system'
    density?: 'default' | 'compact'
  } {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as ReturnType<TranscriptionConfig['read']>
    } catch {
      return {}
    }
  }
  private write(value: ReturnType<TranscriptionConfig['read']>): void {
    const temporary = `${this.path}.${randomUUID()}.tmp`
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
    renameSync(temporary, this.path)
    try {
      chmodSync(this.path, 0o600)
    } catch {
      /* Windows ACLs are managed by the OS. */
    }
  }
  getKey(): string | null {
    const key = this.read().openRouterKey
    return typeof key === 'string' && key ? key : null
  }
  setKey(key: string): void {
    this.write({ ...this.read(), openRouterKey: key.trim() })
  }
  removeKey(): void {
    const value = this.read()
    delete value.openRouterKey
    this.write(value)
  }
  selectedModel(): string {
    const selected = this.read().selectedLocalModel
    return WhisperModelManager.catalog.some((model) => model.id === selected) ? selected! : 'ggml-small.bin'
  }
  setSelectedModel(modelId: string): void {
    this.write({ ...this.read(), selectedLocalModel: modelId })
  }
  preferences() {
    const value = this.read()
    return { theme: value.theme ?? 'system', density: value.density ?? 'default' }
  }
  setPreferences(input: Partial<{ theme: 'light' | 'dark' | 'system'; density: 'default' | 'compact' }>) {
    this.write({ ...this.read(), ...input })
  }
}
