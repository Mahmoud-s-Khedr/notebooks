import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type Database from 'better-sqlite3'
import type { TranscriptionProviderName, TranscriptionRun, TranscriptionSegment, TranscriptionSettings, TranscriptionStatus } from '../../shared/domain'

export interface NormalizedTranscript { text: string; confidence?: number; segments: Array<{ startMs: number; endMs: number; text: string; confidence?: number }> }
export interface TranscriptionProvider { readonly name: TranscriptionProviderName; transcribe(input: { audioPath: string; model: string; language?: string; cancelled?: () => boolean; progress?: (value: number) => void }): Promise<NormalizedTranscript> }
export interface LocalModelStatus { binaryPath: string | null; modelPath: string; available: boolean; download: { state: 'idle' | 'downloading' | 'ready' | 'failed'; progress: number | null; error: string | null } }

/** Downloads are deliberately owned by main process; no renderer path or URL access is exposed. */
export class WhisperModelManager {
  static readonly modelId = 'ggml-small.bin'
  static readonly modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
  // This is the release checksum. Keeping it here makes a changed upstream object fail closed.
  static readonly sha256 = '1be3a9b2063867d3b4c0fbd0c4f9028cf6288fb9cb5d4e35ac3e6a9e0e7eb8f5'
  private status: LocalModelStatus['download'] = { state: 'idle', progress: null, error: null }
  private downloading: Promise<void> | null = null
  constructor(private readonly directory: string, private readonly binaryPath: string | null, private readonly fetcher: typeof fetch = fetch) { mkdirSync(directory, { recursive: true }) }
  path(): string { return join(this.directory, WhisperModelManager.modelId) }
  getStatus(): LocalModelStatus { const available = existsSync(this.path()); return { binaryPath: this.binaryPath && existsSync(this.binaryPath) ? this.binaryPath : null, modelPath: this.path(), available, download: available ? { state: 'ready', progress: 1, error: null } : this.status } }
  async ensure(): Promise<string> {
    if (existsSync(this.path())) return this.path()
    if (!this.downloading) this.downloading = this.download().finally(() => { this.downloading = null })
    await this.downloading; return this.path()
  }
  private async download(): Promise<void> {
    this.status = { state: 'downloading', progress: 0, error: null }; const temporary = `${this.path()}.${randomUUID()}.tmp`
    try {
      const response = await this.fetcher(WhisperModelManager.modelUrl)
      if (!response.ok || !response.body) throw new Error('The multilingual Whisper model could not be downloaded.')
      const length = Number(response.headers.get('content-length') ?? 0); const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let received = 0
      for (;;) { const next = await reader.read(); if (next.done) break; chunks.push(next.value); received += next.value.byteLength; this.status = { state: 'downloading', progress: length ? received / length : null, error: null } }
      const bytes = Buffer.concat(chunks); const hash = createHash('sha256').update(bytes).digest('hex')
      if (hash !== WhisperModelManager.sha256) throw new Error('The downloaded Whisper model failed its integrity check.')
      writeFileSync(temporary, bytes, { mode: 0o600 }); renameSync(temporary, this.path()); this.status = { state: 'ready', progress: 1, error: null }
    } catch (error) { const message = safeError(error); rmSync(temporary, { force: true }); this.status = { state: 'failed', progress: null, error: message }; throw new Error(message) }
  }
}

type RunRow = { id: string; asset_id: string; block_id: string; provider: TranscriptionProviderName; model: string; language: string | null; duration_ms: number | null; status: TranscriptionStatus; confidence: number | null; transcript_text: string | null; error_message: string | null; started_at: string | null; completed_at: string | null; created_at: string; updated_at: string }
const time = () => new Date().toISOString()
const safeError = (error: unknown): string => {
  const value = error instanceof Error ? error.message : 'Transcription failed.'
  return value.replace(/(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+)/gi, '[redacted]').slice(0, 500)
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
    const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body })
    if (!response.ok) throw new Error(`OpenRouter transcription failed (${response.status}).`)
    const payload = await response.json() as { text?: unknown; segments?: Array<{ start?: number; end?: number; text?: unknown; avg_logprob?: number }> }
    if (typeof payload.text !== 'string') throw new Error('OpenRouter returned an invalid transcription response.')
    return { text: payload.text, segments: (payload.segments ?? []).map((segment) => ({ startMs: Math.round((segment.start ?? 0) * 1000), endMs: Math.round((segment.end ?? 0) * 1000), text: typeof segment.text === 'string' ? segment.text : '', confidence: segment.avg_logprob === undefined ? undefined : Math.exp(segment.avg_logprob) })) }
  }
}

/** A small adapter for packaged whisper.cpp binaries. The binary path is intentionally injected. */
export class WhisperCppProvider implements TranscriptionProvider {
  readonly name = 'local' as const
  constructor(private readonly paths: () => { binaryPath: string | null; modelPath: string | null }) {}
  async transcribe(input: { audioPath: string; model: string; language?: string; cancelled?: () => boolean; progress?: (value: number) => void }): Promise<NormalizedTranscript> {
    const paths = this.paths()
    if (!paths.binaryPath || !paths.modelPath || !existsSync(paths.binaryPath) || !existsSync(paths.modelPath)) throw new Error('Local transcription is unavailable. Install the bundled Whisper sidecar and download the multilingual model.')
    const binaryPath = paths.binaryPath; const modelPath = paths.modelPath
    const output = `${input.audioPath}.${randomUUID()}.txt`
    const args = ['-m', modelPath, '-f', input.audioPath, '-otxt', '-oj', '-of', output.replace(/\.txt$/, '')]
    if (input.language) args.push('-l', input.language)
    let child: ReturnType<typeof spawn> | null = null
    try {
      await new Promise<void>((resolveRun, rejectRun) => {
        child = spawn(binaryPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
        let terminated = false
        const timer = setInterval(() => {
          if (!input.cancelled?.() || !child || terminated) return
          terminated = true; child.kill('SIGTERM')
          setTimeout(() => { if (child && !child.killed) child.kill('SIGKILL') }, 2000).unref()
        }, 75)
        child.once('error', (error) => { clearInterval(timer); rejectRun(error) })
        child.once('close', (code) => { clearInterval(timer); if (input.cancelled?.()) rejectRun(new Error('Cancelled')); else if (code === 0) resolveRun(); else rejectRun(new Error('Whisper exited unsuccessfully.')) })
      })
    } catch (error) { rmSync(output, { force: true }); rmSync(output.replace(/\.txt$/, '.json'), { force: true }); if (input.cancelled?.()) throw new Error('Cancelled'); throw new Error('Local Whisper could not transcribe this recording. Check that the WAV is supported and try again.') }
    const text = readFileSync(output, 'utf8').trim()
    const jsonPath = output.replace(/\.txt$/, '.json'); let segments: NormalizedTranscript['segments'] = []
    try { const payload = JSON.parse(readFileSync(jsonPath, 'utf8')) as { transcription?: Array<{ offsets?: { from?: number; to?: number }; text?: string }> }; segments = (payload.transcription ?? []).map((segment) => ({ startMs: Math.max(0, segment.offsets?.from ?? 0), endMs: Math.max(0, segment.offsets?.to ?? 0), text: segment.text ?? '' })) } catch { /* older sidecars only produce text */ }
    return { text, segments }
  }
}

export class TranscriptionService {
  constructor(private readonly db: Database.Database, private readonly audioPath: (relativePath: string) => string, private readonly providers: Record<TranscriptionProviderName, TranscriptionProvider>, private readonly settings: () => TranscriptionSettings) {}
  create(blockId: string, provider: TranscriptionProviderName, model: string, language?: string): TranscriptionRun {
    const asset = this.db.prepare(`SELECT a.id, a.relative_path, b.data_json FROM blocks b JOIN asset_references ar ON ar.block_id = b.id JOIN assets a ON a.id = ar.asset_id WHERE b.id = ? AND b.type = 'audio'`).get(blockId) as { id: string; relative_path: string; data_json: string } | undefined
    if (!asset || !asset.relative_path.endsWith('.wav')) throw new Error('This audio block needs a retained WAV recording before it can be transcribed.')
    if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) throw new Error('The transcription model identifier is invalid.')
    if (language && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) throw new Error('The language hint is invalid.')
    const created = time(); const id = randomUUID()
    this.db.prepare('INSERT INTO transcription_runs (id, asset_id, block_id, provider, model, language, duration_ms, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, asset.id, blockId, provider, model, language ?? null, this.wavDuration(this.audioPath(asset.relative_path)), 'queued', created, created)
    this.db.prepare("UPDATE blocks SET data_json = json_set(data_json, '$.activeTranscriptionRunId', ?), updated_at = ? WHERE id = ?").run(id, created, blockId)
    return this.get(id)
  }
  async execute(runId: string, cancelled: () => boolean = () => false, progress: (value: number) => void = () => {}): Promise<TranscriptionRun> {
    const row = this.row(runId); const path = this.db.prepare('SELECT relative_path FROM assets WHERE id = ?').get(row.asset_id) as { relative_path: string }
    const started = time(); this.db.prepare("UPDATE transcription_runs SET status = 'running', started_at = ?, error_message = NULL, updated_at = ? WHERE id = ?").run(started, started, runId)
    try {
      const output = await this.providers[row.provider].transcribe({ audioPath: this.audioPath(path.relative_path), model: row.model, language: row.language ?? undefined, cancelled, progress })
      if (cancelled()) throw new Error('Cancelled')
      const completed = time()
      this.db.transaction(() => { this.db.prepare("UPDATE transcription_runs SET status = 'completed', transcript_text = ?, confidence = ?, completed_at = ?, updated_at = ? WHERE id = ?").run(output.text, output.confidence ?? null, completed, completed, runId); const insert = this.db.prepare('INSERT INTO transcription_segments (id, run_id, position, start_ms, end_ms, text, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)'); output.segments.forEach((s, position) => insert.run(randomUUID(), runId, position, Math.max(0, s.startMs), Math.max(s.startMs, s.endMs), s.text, s.confidence ?? null)) })()
    } catch (error) { const completed = time(); if (cancelled()) this.db.prepare("UPDATE transcription_runs SET status = 'cancelled', error_message = NULL, completed_at = ?, updated_at = ? WHERE id = ?").run(completed, completed, runId); else this.db.prepare("UPDATE transcription_runs SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?").run(safeError(error), completed, completed, runId) }
    return this.get(runId)
  }
  async retry(runId: string): Promise<TranscriptionRun> { const prior = this.row(runId); const run = this.create(prior.block_id, prior.provider, prior.model, prior.language ?? undefined); return this.execute(run.id) }
  get(runId: string): TranscriptionRun { const row = this.row(runId); const segments = this.db.prepare('SELECT * FROM transcription_segments WHERE run_id = ? ORDER BY position').all(runId) as Array<{ id: string; position: number; start_ms: number; end_ms: number; text: string; confidence: number | null }>; return { id: row.id, assetId: row.asset_id, blockId: row.block_id, provider: row.provider, model: row.model, language: row.language, durationMs: row.duration_ms, status: row.status, confidence: row.confidence, transcriptText: row.transcript_text, errorMessage: row.error_message, startedAt: row.started_at, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at, segments: segments.map((s): TranscriptionSegment => ({ id: s.id, position: s.position, startMs: s.start_ms, endMs: s.end_ms, text: s.text, confidence: s.confidence })) } }
  list(blockId: string): TranscriptionRun[] { return (this.db.prepare('SELECT id FROM transcription_runs WHERE block_id = ? ORDER BY created_at DESC').all(blockId) as Array<{ id: string }>).map(({ id }) => this.get(id)) }
  getSettings(): TranscriptionSettings { return this.settings() }
  private row(id: string): RunRow { const row = this.db.prepare('SELECT * FROM transcription_runs WHERE id = ?').get(id) as RunRow | undefined; if (!row) throw new Error('Transcription run does not exist.'); return row }
  private wavDuration(path: string): number | null { try { const data = readFileSync(path); if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') return null; const rate = data.readUInt32LE(24); const bytesPerSecond = data.readUInt32LE(28); const size = data.readUInt32LE(40); return rate && bytesPerSecond ? Math.round(size / bytesPerSecond * 1000) : null } catch { return null } }
}

export class TranscriptionConfig {
  private readonly path: string
  constructor(directory: string) { mkdirSync(directory, { recursive: true }); this.path = join(directory, 'transcription.json') }
  getKey(): string | null { try { const key = JSON.parse(readFileSync(this.path, 'utf8')).openRouterKey; return typeof key === 'string' && key ? key : null } catch { return null } }
  setKey(key: string): void { const temporary = `${this.path}.${randomUUID()}.tmp`; writeFileSync(temporary, JSON.stringify({ openRouterKey: key.trim() }), { mode: 0o600 }); renameSync(temporary, this.path); try { chmodSync(this.path, 0o600) } catch { /* Windows ACLs are managed by the OS. */ } }
}
