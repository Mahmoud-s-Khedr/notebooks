import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { NotebookDatabase } from '../database/database'
import { assertNoStaging, TestLibrary, validWav, waitForJob, writeFixture } from '../test-support'
import { NotebookService } from './notebook-service'

describe('library data safety on disk', () => {
  const libraries: TestLibrary[] = []
  afterEach(() => libraries.splice(0).forEach((library) => library.close()))
  const library = () => {
    const value = new TestLibrary()
    libraries.push(value)
    return value
  }

  it('round-trips a complete notebook graph with new IDs and managed bytes', () => {
    const source = library()
    const notebook = source.service.createNotebook('Complete graph')
    const page = source.service.createPage(notebook.id, 'Evidence')
    const note = source.service.createNote(page.id, 'Observations')
    const image = source.service.importAsset(
      notebook.id,
      'image',
      writeFixture(source.root, 'chart.png', 'image bytes')
    )
    const imageBlock = source.service.attachAsset(note.id, image.id, 'image')
    const pdf = source.service.importPdf(notebook.id, writeFixture(source.root, 'paper.pdf', '%PDF-1.4 fixture'))
    const sourceBlock = source.service.captureSourceText(note.id, pdf.id, 2, 7, 'A cited finding.')
    const audioBlock = source.service.saveRecording(note.id, validWav().toString('base64'))
    source.service.createRelation(imageBlock.id, sourceBlock.id, 'comments_on')
    const audioId = String(audioBlock.data.assetId)
    const runId = randomUUID()
    const created = new Date().toISOString()
    source.database.connection
      .prepare(
        "INSERT INTO transcription_runs (id,asset_id,block_id,provider,model,status,transcript_text,created_at,updated_at) VALUES (?,?,?,?,?,'completed',?,?,?)"
      )
      .run(runId, audioId, audioBlock.id, 'openrouter', 'test-model', 'Recorded words', created, created)
    source.database.connection
      .prepare('INSERT INTO transcription_segments (id,run_id,position,start_ms,end_ms,text) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), runId, 0, 0, 100, 'Recorded words')
    source.database.connection
      .prepare("UPDATE blocks SET data_json=json_set(data_json, '$.activeTranscriptionRunId', ?) WHERE id=?")
      .run(runId, audioBlock.id)

    const exports = join(source.root, 'exports')
    const exported = source.service.export({ type: 'notebook', notebookId: notebook.id }, 'lossless-json', exports)
    const archive = join(exported.directory, 'notebook.lossless.v1.json')
    const target = library()
    const imported = target.service.importLossless(archive)
    expect(imported.notebook.id).not.toBe(notebook.id)
    expect(imported.importedAssets).toBe(3)
    expect(target.database.connection.prepare('SELECT COUNT(*) AS count FROM pages').get()).toEqual({ count: 1 })
    expect(target.database.connection.prepare('SELECT COUNT(*) AS count FROM block_relations').get()).toEqual({
      count: 1
    })
    expect(target.database.connection.prepare('SELECT COUNT(*) AS count FROM source_documents').get()).toEqual({
      count: 1
    })
    expect(target.database.connection.prepare('SELECT transcript_text FROM transcription_runs').get()).toEqual({
      transcript_text: 'Recorded words'
    })
    expect(target.database.connection.prepare('SELECT COUNT(*) AS count FROM transcription_segments').get()).toEqual({
      count: 1
    })
    const importedAsset = target.database.connection.prepare('SELECT relative_path FROM assets LIMIT 1').get() as {
      relative_path: string
    }
    expect(existsSync(join(target.assets, importedAsset.relative_path.replace('assets/', '')))).toBe(true)
  })

  it('rejects invalid archives before changing the target database or asset library', () => {
    const source = library()
    const notebook = source.service.createNotebook('Portable')
    const page = source.service.createPage(notebook.id, 'Page')
    const note = source.service.createNote(page.id, 'Note')
    const asset = source.service.importAsset(
      notebook.id,
      'image',
      writeFixture(source.root, 'fixture.png', 'image bytes')
    )
    source.service.attachAsset(note.id, asset.id, 'image')
    const exported = source.service.export(
      { type: 'notebook', notebookId: notebook.id },
      'lossless-json',
      join(source.root, 'exports')
    )
    const original = JSON.parse(readFileSync(join(exported.directory, 'notebook.lossless.v1.json'), 'utf8')) as Record<
      string,
      any
    >
    const target = library()
    const count = () =>
      (target.database.connection.prepare('SELECT COUNT(*) AS count FROM notebooks').get() as { count: number }).count
    const badArchives = [
      '{ definitely not json',
      JSON.stringify({ ...original, schemaVersion: 999 }),
      JSON.stringify({ ...original, pages: [...original.pages, original.pages[0]] }),
      JSON.stringify({ ...original, pages: [{ ...original.pages[0], position: 3 }] }),
      JSON.stringify({ ...original, assets: [{ ...original.assets[0], exportPath: '../outside.png' }] }),
      JSON.stringify({ ...original, assets: [{ ...original.assets[0], exportPath: 'assets\\bad.png' }] }),
      JSON.stringify({ ...original, assets: [{ ...original.assets[0], sha256: '0'.repeat(64) }] })
    ]
    for (const [index, contents] of badArchives.entries()) {
      const path = writeFixture(source.root, `bad-${index}.json`, contents)
      expect(() => target.service.importLossless(path)).toThrow()
      expect(count()).toBe(0)
      assertNoStaging(target.assets)
    }
  })

  it('backs up verified managed bytes and leaves no backup residue on missing or corrupt input', async () => {
    const value = library()
    const notebook = value.service.createNotebook('Backup')
    const asset = value.service.importAsset(
      notebook.id,
      'file',
      writeFixture(value.root, 'attachment.bin', 'safe bytes')
    )
    const destination = join(value.root, 'backups')
    mkdirSync(destination)
    const completed = await waitForJob(value.service, value.service.startBackup(destination))
    expect(completed.status).toBe('completed')
    const backup = String(completed.result?.directory)
    expect(readFileSync(join(backup, 'RECOVERY.md'), 'utf8')).toContain('Recovery instructions')
    const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8')) as {
      assets: Array<{ sha256: string }>
    }
    expect(manifest.assets[0].sha256).toBe(createHash('sha256').update('safe bytes').digest('hex'))

    rmSync(join(value.assets, asset.relativePath.replace('assets/', '')))
    const failed = await waitForJob(value.service, value.service.startBackup(destination))
    expect(failed.status).toBe('failed')
    assertNoStaging(destination)
  })

  it('uses exact trash operation matching and only removes unreferenced assets after permanent deletion', () => {
    const value = library()
    const notebook = value.service.createNotebook('Trash')
    const page = value.service.createPage(notebook.id, 'P')
    const note = value.service.createNote(page.id, 'N')
    const asset = value.service.importAsset(notebook.id, 'image', writeFixture(value.root, 'x.png', 'asset'))
    const block = value.service.attachAsset(note.id, asset.id, 'image')
    const operation = value.service.moveToTrash('page', page.id)
    expect(() => value.service.restoreFromTrash('page', page.id, randomUUID())).toThrow('does not exist')
    value.service.restoreFromTrash('page', page.id, operation.deletionOperationId)
    value.service.moveToTrash('block', block.id)
    value.service.permanentlyDelete('block', block.id)
    expect(value.service.diagnoseAssets(notebook.id).orphaned).toContainEqual(expect.objectContaining({ id: asset.id }))
    value.service.removeAsset(asset.id)
    expect(value.service.listAssets(notebook.id)).toEqual([])
    value.service.emptyTrash()
    expect(value.service.listTrash()).toEqual([])
  })

  it('activates a relocated disk library only after verification and preserves the original until removal', async () => {
    const root = library()
    const notebook = root.service.createNotebook('Move me')
    root.service.importAsset(notebook.id, 'file', writeFixture(root.root, 'move.bin', 'move bytes'))
    const destination = `${root.root}-new-parent`
    const bootstrap = join(root.root, 'bootstrap.json')
    const moveService = new NotebookService(root.database, root.assets, root.config, undefined, {
      root: root.root,
      bootstrapPath: bootstrap
    })
    const moved = await waitForJob(moveService, moveService.startLibraryMove(destination))
    expect(moved.errorMessage).toBeNull()
    expect(moved.status).toBe('completed')
    const pointer = JSON.parse(readFileSync(bootstrap, 'utf8')) as { activeRoot: string; previousRoot: string }
    expect(pointer.previousRoot).toBe(root.root)
    expect(existsSync(join(pointer.activeRoot, 'database.sqlite'))).toBe(true)
    expect(existsSync(join(root.root, 'database.sqlite'))).toBe(true)
    const reopened = new NotebookDatabase(join(pointer.activeRoot, 'database.sqlite'))
    expect(reopened.connection.prepare('SELECT title FROM notebooks').get()).toEqual({ title: 'Move me' })
    reopened.close()
    rmSync(destination, { recursive: true, force: true })
  })

  it('removes a promoted copy when activation cannot publish a bootstrap pointer', async () => {
    const root = library()
    root.service.createNotebook('Must not activate')
    const destination = `${root.root}-unactivated-parent`
    const failed = await waitForJob(root.service, root.service.startLibraryMove(destination))
    expect(failed.status).toBe('failed')
    expect(failed.errorMessage).toContain('cannot activate')
    expect(readdirSync(destination)).toEqual([])
    assertNoStaging(destination)
    rmSync(destination, { recursive: true, force: true })
  })
})

describe('migration write barrier', () => {
  it('rejects writes while copying and awaiting restart, then reopens the destination before original removal', async () => {
    const root = new TestLibrary()
    const destination = `${root.root}-barrier`
    const bootstrap = join(root.root, 'bootstrap.json')
    let reopened: NotebookDatabase | undefined
    try {
      const service = new NotebookService(root.database, root.assets, root.config, undefined, {
        root: root.root,
        bootstrapPath: bootstrap
      })
      const notebook = service.createNotebook('Protected')
      const page = service.createPage(notebook.id, 'Page')
      const note = service.createNote(page.id, 'Note')
      const job = service.startLibraryMove(destination)
      expect(['queued', 'copying']).toContain(service.migrationStatus().state)
      for (const mutate of [
        () => service.createNote(page.id, 'Lost'),
        () => service.updateNote(note.id, 'Changed'),
        () => service.updatePreferences({ theme: 'dark' }),
        () => service.startBackup(root.root),
        () => service.saveRecording(note.id, validWav().toString('base64'))
      ])
        expect(mutate).toThrow('Library move')
      await waitForJob(service, job)
      expect(service.migrationStatus().state).toBe('pending-restart')
      expect(() => service.createNotebook('Late write')).toThrow('Library move')
      expect(() => service.removeOldLibrary()).toThrow('no retained original')
      const pointer = JSON.parse(readFileSync(bootstrap, 'utf8'))
      reopened = new NotebookDatabase(join(pointer.activeRoot, 'database.sqlite'))
      const activated = new NotebookService(
        reopened,
        join(pointer.activeRoot, 'assets'),
        join(pointer.activeRoot, 'config'),
        undefined,
        { root: pointer.activeRoot, bootstrapPath: bootstrap, previousRoot: root.root }
      )
      expect(activated.listNotebooks()[0].title).toBe('Protected')
      expect(activated.listJobs().find((j) => j.kind === 'library-move')?.status).toBe('completed')
      activated.createNotebook('After restart')
      activated.removeOldLibrary()
      expect(existsSync(pointer.activeRoot)).toBe(true)
    } finally {
      reopened?.close()
      root.close()
      rmSync(destination, { recursive: true, force: true })
    }
  })
  it('releases the barrier after cancellation and refuses a move with active jobs', async () => {
    const root = new TestLibrary()
    const destination = `${root.root}-cancel`
    try {
      const service = new NotebookService(root.database, root.assets, root.config, undefined, {
        root: root.root,
        bootstrapPath: join(root.root, 'bootstrap.json')
      })
      const job = service.startLibraryMove(destination)
      expect(() => service.startLibraryMove(destination)).toThrow('Library move')
      service.cancelJob(job.id)
      await waitForJob(service, job)
      expect(service.migrationStatus().state).toBe('failed')
      expect(() => service.createNotebook('Recovered')).not.toThrow()
      const id = randomUUID()
      root.database.connection
        .prepare(
          "INSERT INTO jobs(id,kind,status,payload_json,created_at,updated_at) VALUES (?,'backup','queued','{}',?,?)"
        )
        .run(id, new Date().toISOString(), new Date().toISOString())
      expect(() => service.startLibraryMove(destination)).toThrow('Finish or cancel')
    } finally {
      root.close()
      rmSync(destination, { recursive: true, force: true })
    }
  })
})

describe('recording commit safety', () => {
  it('rolls back partial attachment writes and deduplicates retries by operation ID', () => {
    const root = new TestLibrary()
    try {
      const notebook = root.service.createNotebook('Recordings')
      const page = root.service.createPage(notebook.id, 'Audio')
      const note = root.service.createNote(page.id, 'Target')
      const operationId = randomUUID()
      root.database.connection.exec(
        "CREATE TRIGGER reject_recording BEFORE INSERT ON asset_references BEGIN SELECT RAISE(ABORT,'Controlled attachment failure'); END"
      )
      expect(() => root.service.saveRecording(note.id, validWav().toString('base64'), 'test.wav', operationId)).toThrow(
        'Controlled attachment failure'
      )
      expect(root.service.listAssets(notebook.id)).toEqual([])
      expect(root.service.getPageWorkspace(page.id).notes[0].blocks).toEqual([])
      root.database.connection.exec('DROP TRIGGER reject_recording')
      const first = root.service.saveRecording(note.id, validWav().toString('base64'), 'test.wav', operationId)
      const repeated = root.service.saveRecording(note.id, validWav().toString('base64'), 'test.wav', operationId)
      expect(repeated.id).toBe(first.id)
      expect(root.service.listAssets(notebook.id)).toHaveLength(1)
      expect(root.service.getPageWorkspace(page.id).notes[0].blocks).toHaveLength(1)
    } finally {
      root.close()
    }
  })
})

describe('failed library copy recovery', () => {
  it('keeps the original and releases writes after managed-byte verification fails', async () => {
    const root = new TestLibrary()
    const destination = `${root.root}-failed-move`
    try {
      const service = new NotebookService(root.database, root.assets, root.config, undefined, {
        root: root.root,
        bootstrapPath: join(root.root, 'bootstrap.json')
      })
      const notebook = service.createNotebook('Original')
      const asset = service.importAsset(notebook.id, 'file', writeFixture(root.root, 'evidence.bin', 'verified bytes'))
      writeFixture(join(root.assets, 'files'), asset.relativePath.split('/').at(-1)!, 'changed after import')
      const job = await waitForJob(service, service.startLibraryMove(destination))
      expect(job.status).toBe('failed')
      expect(service.migrationStatus().state).toBe('failed')
      expect(existsSync(join(root.root, 'database.sqlite'))).toBe(true)
      expect(() => service.createNotebook('Recovered')).not.toThrow()
      assertNoStaging(destination)
    } finally {
      root.close()
      rmSync(destination, { recursive: true, force: true })
    }
  })
})
