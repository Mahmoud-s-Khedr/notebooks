import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { TestLibrary, validWav, waitForJob, writeFixture } from '../test-support'
import { ExportService } from './export-service'
import { JobService } from './job-service'
import { TranscriptionConfig, WhisperCppProvider, WhisperModelManager } from './transcription-service'

describe('repair failure boundaries', () => {
  const libraries: TestLibrary[] = []
  const library = () => {
    const value = new TestLibrary()
    libraries.push(value)
    return value
  }
  afterEach(() => libraries.splice(0).forEach((l) => l.close()))
  const graph = () => {
    const value = library()
    const notebook = value.service.createNotebook('مختبر Research')
    const page = value.service.createPage(notebook.id, 'Page')
    const note = value.service.createNote(page.id, 'Note')
    return { value, notebook, page, note }
  }

  it('stages immutable export bytes and content before PDF rendering yields', () => {
    const { value, notebook, note } = graph()
    const asset = value.service.importAsset(notebook.id, 'image', writeFixture(value.root, 'image.png', 'original'))
    const block = value.service.attachAsset(note.id, asset.id, 'image')
    const exporter = new ExportService(value.database.connection, (relative) =>
      join(value.assets, relative.replace('assets/', ''))
    )
    const scope = { type: 'notebook', notebookId: notebook.id } as const
    const snapshot = exporter.snapshot(scope)
    const staging = join(value.root, 'snapshot')
    const staged = exporter.stageSnapshot(snapshot, staging)
    value.service.updateBlock(block.id, { text: 'new state' })
    writeFileSync(join(value.assets, asset.relativePath.replace('assets/', '')), 'changed')
    const html = staged.printableDocument(scope, snapshot)
    expect(html).not.toContain('new state')
    expect(html).toContain(Buffer.from('original').toString('base64'))
    const output = staged.start(scope, 'pdf', join(value.root, 'exports'), Buffer.from('pdf snapshot'), snapshot)
    const manifest = JSON.parse(readFileSync(output.manifestPath, 'utf8'))
    expect(readFileSync(join(output.directory, manifest.assets[0].path), 'utf8')).toBe('original')
  })

  it('rejects a physically escaping symlink before import changes the library', () => {
    const { value, notebook, note } = graph()
    const asset = value.service.importAsset(notebook.id, 'image', writeFixture(value.root, 'image.png', 'bytes'))
    value.service.attachAsset(note.id, asset.id, 'image')
    const output = value.service.export(
      { type: 'notebook', notebookId: notebook.id },
      'lossless-json',
      join(value.root, 'exports')
    )
    const archivePath = join(output.directory, 'notebook.lossless.v1.json')
    const archive = JSON.parse(readFileSync(archivePath, 'utf8'))
    const path = join(output.directory, archive.assets[0].exportPath)
    rmSync(path)
    symlinkSync(writeFixture(value.root, 'outside.png', 'bytes'), path)
    const target = library()
    expect(() => target.service.importLossless(archivePath)).toThrow('integrity')
    expect(target.service.listNotebooks()).toEqual([])
  })

  it('copies reviewed/raw transcription graphs and remaps internal and outgoing relations', () => {
    const { value, notebook, page, note } = graph()
    const audio = value.service.saveRecording(note.id, validWav().toString('base64'), undefined, randomUUID())
    const text = value.service.createBlock(note.id, 'text', { text: 'target' })
    const externalNote = value.service.createNote(page.id, 'Outside')
    const external = value.service.createBlock(externalNote.id, 'text', { text: 'external' })
    value.service.createRelation(audio.id, text.id, 'comments_on')
    value.service.createRelation(text.id, external.id, 'explains')
    value.service.createRelation(external.id, text.id, 'responds_to')
    const runId = randomUUID()
    const time = new Date().toISOString()
    value.database.connection
      .prepare(
        "INSERT INTO transcription_runs (id,asset_id,block_id,provider,model,status,transcript_text,created_at,updated_at) VALUES (?,?,?,?,?,'completed',?,?,?)"
      )
      .run(runId, audio.data.assetId, audio.id, 'local', 'base', 'raw words', time, time)
    value.database.connection
      .prepare('INSERT INTO transcription_segments (id,run_id,position,start_ms,end_ms,text) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), runId, 0, 0, 100, 'raw words')
    value.service.updateBlock(audio.id, { ...audio.data, activeTranscriptionRunId: runId })
    value.service.reviewTranscript(runId, 'مراجعة reviewed')
    const copiedNote = value.service.duplicateNote(note.id)
    const copiedBlocks = value.service.getPageWorkspace(page.id).notes.find((n) => n.id === copiedNote.id)!.blocks
    const copiedAudio = copiedBlocks.find((b) => b.type === 'audio')!
    const copiedText = copiedBlocks.find((b) => b.type === 'text')!
    const copiedRun = value.service.listTranscriptions(copiedAudio.id)[0]
    expect(copiedRun.id).not.toBe(runId)
    expect(copiedRun.transcriptText).toBe('raw words')
    expect(copiedRun.segments[0].text).toBe('raw words')
    expect(copiedAudio.metadata.recordingOperationId).toBeUndefined()
    expect(copiedAudio.data.transcriptReviews).toHaveProperty(copiedRun.id)
    expect(value.service.listRelations(copiedAudio.id)).toContainEqual(
      expect.objectContaining({ toBlockId: copiedText.id })
    )
    expect(value.service.listRelations(copiedText.id)).toContainEqual(
      expect.objectContaining({ toBlockId: external.id })
    )
    expect(value.service.listRelations(external.id).filter((r) => r.relationType === 'responds_to')).toEqual([
      expect.objectContaining({ toBlockId: text.id })
    ])
    const output = value.service.export(
      { type: 'notebook', notebookId: notebook.id },
      'lossless-json',
      join(value.root, 'exports')
    )
    const target = library()
    target.service.importLossless(join(output.directory, 'notebook.lossless.v1.json'))
    const imported = target.database.connection.prepare("SELECT data_json FROM blocks WHERE type='audio'").all() as {
      data_json: string
    }[]
    for (const item of imported) {
      const data = JSON.parse(item.data_json)
      expect(data.transcriptReviews[data.activeTranscriptionRunId].text).toBe('مراجعة reviewed')
    }
  })

  it('previews and cleans only old finished jobs and diagnostics, preserving active work and content', () => {
    const { value, note } = graph()
    value.service.createBlock(note.id, 'text', { text: 'keep' })
    const old = '2020-01-01T00:00:00.000Z'
    const recent = new Date().toISOString()
    const insert = value.database.connection.prepare(
      "INSERT INTO jobs (id,kind,status,payload_json,created_at,updated_at,completed_at) VALUES (?,'export',?,'{}',?,?,?)"
    )
    insert.run(randomUUID(), 'completed', old, old, old)
    insert.run(randomUUID(), 'running', old, old, null)
    insert.run(randomUUID(), 'completed', recent, recent, recent)
    expect(value.service.historyCleanup('jobs')).toBe(1)
    expect(value.service.listJobs()).toHaveLength(3)
    expect(value.service.historyCleanup('jobs', 30, true)).toBe(1)
    expect(value.service.listJobs()).toHaveLength(2)
    expect(value.service.historyCleanup('jobs', 0)).toBe(1)
    expect(value.service.historyCleanup('jobs', 0, true)).toBe(1)
    expect(value.service.listJobs().map((job) => job.status)).toEqual(['running'])
    expect(value.database.connection.prepare('SELECT COUNT(*) AS count FROM blocks').get()).toEqual({ count: 1 })
  })

  it('reconciles queued cancellation and restart with transcription run state', () => {
    const { value, note } = graph()
    const audio = value.service.saveRecording(note.id, validWav().toString('base64'))
    const time = new Date().toISOString()
    const run = randomUUID()
    const job = randomUUID()
    value.database.connection
      .prepare(
        "INSERT INTO transcription_runs (id,asset_id,block_id,provider,model,status,created_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?)"
      )
      .run(run, audio.data.assetId, audio.id, 'local', 'base', time, time)
    value.database.connection
      .prepare(
        "INSERT INTO jobs (id,kind,status,payload_json,created_at,updated_at) VALUES (?,'transcription','queued',?,?,?)"
      )
      .run(job, JSON.stringify({ runId: run }), time, time)
    const queue = new JobService(value.database.connection)
    queue.cancel(job)
    expect(value.service.getTranscription(run).status).toBe('cancelled')
    value.database.connection.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job)
    value.database.connection.prepare("UPDATE transcription_runs SET status='running' WHERE id=?").run(run)
    new JobService(value.database.connection)
    expect(value.service.getTranscription(run).status).toBe('failed')
  })

  it('integrity jobs never report clean when bytes are missing', async () => {
    const { value, notebook } = graph()
    const asset = value.service.importAsset(notebook.id, 'file', writeFixture(value.root, 'file.bin', 'bytes'))
    rmSync(join(value.assets, asset.relativePath.replace('assets/', '')))
    const result = await waitForJob(value.service, value.service.startIntegrityScan(notebook.id))
    expect(result.result).toMatchObject({ clean: false, missingAssetIds: [asset.id] })
  })

  it('encrypts credentials before atomic migration and supports session-only keys', () => {
    const value = library()
    mkdirSync(value.config, { recursive: true })
    const path = writeFixture(
      value.config,
      'transcription.json',
      JSON.stringify({ openRouterKey: 'legacy-secret', theme: 'dark' })
    )
    const secure = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from([...s].reverse().join('')),
      decryptString: (b: Buffer) => [...b.toString()].reverse().join('')
    }
    const config = new TranscriptionConfig(value.config, secure)
    expect(config.getKey()).toBe('legacy-secret')
    expect(readFileSync(path, 'utf8')).not.toContain('legacy-secret')
    expect(new TranscriptionConfig(value.config, secure).getKey()).toBe('legacy-secret')
    const ephemeral = new TranscriptionConfig(value.config)
    ephemeral.setKey('session-secret')
    expect(ephemeral.getKey()).toBe('session-secret')
    expect(readFileSync(path, 'utf8')).not.toContain('session-secret')
    expect(new TranscriptionConfig(value.config).getKey()).toBeNull()
    expect(config.preferences().theme).toBe('dark')
  })

  it('preserves legacy plaintext if encrypted replacement cannot be verified', () => {
    const value = library()
    const path = writeFixture(value.config, 'transcription.json', JSON.stringify({ openRouterKey: 'legacy-secret' }))
    const original = readFileSync(path, 'utf8')
    const config = new TranscriptionConfig(value.config, {
      isEncryptionAvailable: () => true,
      encryptString: () => Buffer.from('encrypted'),
      decryptString: () => 'incorrect round trip'
    })
    expect(() => config.getKey()).toThrow('Credential encryption did not verify')
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('aborts pending model reads and removes partial files', async () => {
    const value = library()
    let cancel = false
    const fetcher = vi.fn(async (_url, options) => {
      const signal = options!.signal as AbortSignal
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]))
            signal.addEventListener('abort', () => controller.error(new Error('aborted')))
          }
        })
      )
    }) as typeof fetch
    const directory = join(value.root, 'models')
    const models = new WhisperModelManager(directory, null, fetcher)
    const downloading = models.download('ggml-tiny.bin', () => cancel)
    await new Promise((resolve) => setTimeout(resolve, 30))
    cancel = true
    await expect(downloading).rejects.toThrow('Cancelled')
    expect(readdirSync(directory)).toEqual([])
  })

  it('cleans successful sidecar output and escalates termination for a worker ignoring SIGTERM', async () => {
    if (process.platform === 'win32') return
    const value = library()
    const wav = writeFixture(value.root, 'clip.wav', validWav())
    const model = writeFixture(value.root, 'model.bin', 'model')
    const binary = writeFixture(
      value.root,
      'worker',
      `#!/usr/bin/env node\nconst fs = require('fs'); const args = process.argv; const prefix = args[args.indexOf('-of')+1]; fs.writeFileSync(prefix+'.txt', 'raw result'); fs.writeFileSync(prefix+'.json', '{}');\n`
    )
    chmodSync(binary, 0o700)
    const provider = new WhisperCppProvider(() => ({ binaryPath: binary, modelPath: model }))
    expect(await provider.transcribe({ audioPath: wav, model: 'base' })).toMatchObject({ text: 'raw result' })
    expect(readdirSync(value.root).some((n) => n.startsWith('clip.wav.'))).toBe(false)
    writeFileSync(binary, `#!/usr/bin/env node\nprocess.on('SIGTERM', () => {}); setInterval(() => {}, 100);\n`)
    let cancelled = false
    const running = provider.transcribe({ audioPath: wav, model: 'base', cancelled: () => cancelled })
    await new Promise((resolve) => setTimeout(resolve, 150))
    cancelled = true
    await expect(running).rejects.toThrow('Cancelled')
    expect(existsSync(binary)).toBe(true)
  }, 5000)
})
