import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { NotebookDatabase } from '../database/database'
import { NotebookService } from './notebook-service'

describe('NotebookService', () => {
  const databases: NotebookDatabase[] = []

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close())
  })

  it('restores a persisted hierarchy and reordered blocks after reopening the database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-notebook-test-'))
    const databasePath = join(directory, 'database.sqlite')
    const database = new NotebookDatabase(databasePath)
    databases.push(database)
    const service = new NotebookService(database)
    const notebook = service.createNotebook('Grade 11 AI')
    const page = service.createPage(notebook.id, 'How AI Works')
    const note = service.createNote(page.id, 'Neural networks')
    const first = service.createBlock(note.id, 'text', { text: 'First explanation' })
    const second = service.createBlock(note.id, 'text', { text: 'Second explanation' })

    service.reorderBlocks(note.id, [second.id, first.id])

    database.close()
    databases.pop()
    const reopenedDatabase = new NotebookDatabase(databasePath)
    databases.push(reopenedDatabase)
    const reloadedService = new NotebookService(reopenedDatabase)
    const restored = reloadedService.getPageWorkspace(page.id)
    expect(restored.notes).toHaveLength(1)
    expect(restored.notes[0].blocks.map((block) => block.data.text)).toEqual(['Second explanation', 'First explanation'])
    expect(reloadedService.listNotebooks()[0].pages[0].id).toBe(page.id)
    reopenedDatabase.close()
    databases.pop()
    rmSync(directory, { recursive: true, force: true })
  })

  it('rejects a reorder that does not exactly match the note blocks', () => {
    const database = new NotebookDatabase(':memory:')
    databases.push(database)
    const service = new NotebookService(database)
    const notebook = service.createNotebook('Research')
    const page = service.createPage(notebook.id, 'Topic')
    const note = service.createNote(page.id, 'Note')
    const block = service.createBlock(note.id, 'text')

    expect(() => service.reorderBlocks(note.id, [block.id, crypto.randomUUID()])).toThrow('submitted order does not match')
    expect(service.getPageWorkspace(page.id).notes[0].blocks[0].id).toBe(block.id)
  })

  it('keeps independently deleted descendants in their own trash operation when a parent is restored', () => {
    const database = new NotebookDatabase(':memory:')
    databases.push(database)
    const service = new NotebookService(database)
    const notebook = service.createNotebook('Research')
    const page = service.createPage(notebook.id, 'Topic')
    const note = service.createNote(page.id, 'Questions')
    const earlierBlock = service.createBlock(note.id, 'text', { text: 'Deleted first' })
    const laterBlock = service.createBlock(note.id, 'text', { text: 'Deleted with page' })

    const firstOperation = service.moveToTrash('block', earlierBlock.id)
    const pageOperation = service.moveToTrash('page', page.id)
    expect(service.listNotebooks()[0].pages).toHaveLength(0)

    service.restoreFromTrash('page', page.id, pageOperation.deletionOperationId)
    const restored = service.getPageWorkspace(page.id)
    expect(restored.notes[0].blocks.map(({ id }) => id)).toEqual([laterBlock.id])
    expect(service.listTrash()).toEqual(expect.arrayContaining([expect.objectContaining({ id: earlierBlock.id, deletionOperationId: firstOperation.deletionOperationId })]))

    service.restoreFromTrash('block', earlierBlock.id, firstOperation.deletionOperationId)
    expect(service.getPageWorkspace(page.id).notes[0].blocks.map(({ id }) => id)).toEqual([earlierBlock.id, laterBlock.id])
  })

  it('duplicates notes and blocks with fresh IDs while preserving ordered content', () => {
    const database = new NotebookDatabase(':memory:')
    databases.push(database)
    const service = new NotebookService(database)
    const notebook = service.createNotebook('Research')
    const page = service.createPage(notebook.id, 'Topic')
    const note = service.createNote(page.id, 'Original')
    const block = service.createBlock(note.id, 'commentary', { text: 'Keep this thought' })

    const blockCopy = service.duplicateBlock(block.id)
    const noteCopy = service.duplicateNote(note.id)
    const workspace = service.getPageWorkspace(page.id)
    expect(blockCopy.id).not.toBe(block.id)
    expect(workspace.notes[0].blocks.map(({ data }) => data.text)).toEqual(['Keep this thought', 'Keep this thought'])
    expect(noteCopy.id).not.toBe(note.id)
    expect(workspace.notes[1].blocks).toHaveLength(2)
    expect(workspace.notes[1].blocks.map(({ data }) => data.text)).toEqual(['Keep this thought', 'Keep this thought'])
  })

  it('validates block relations against active blocks in the same notebook', () => {
    const database = new NotebookDatabase(':memory:')
    databases.push(database)
    const service = new NotebookService(database)
    const notebook = service.createNotebook('Research')
    const page = service.createPage(notebook.id, 'Topic')
    const note = service.createNote(page.id, 'Note')
    const question = service.createBlock(note.id, 'question', { text: 'Why?' })
    const answer = service.createBlock(note.id, 'answer', { text: 'Because.' })
    const relation = service.createRelation(answer.id, question.id, 'responds_to')
    expect(service.listRelations(question.id)).toEqual([expect.objectContaining({ id: relation.id, relationType: 'responds_to' })])

    const otherNotebook = service.createNotebook('Other')
    const otherPage = service.createPage(otherNotebook.id, 'Other page')
    const otherNote = service.createNote(otherPage.id, 'Other note')
    const unrelated = service.createBlock(otherNote.id, 'text')
    expect(() => service.createRelation(question.id, unrelated.id, 'explains')).toThrow('same notebook')
    service.moveToTrash('block', answer.id)
    expect(() => service.createRelation(question.id, answer.id, 'explains')).toThrow('active')
  })

  it('indexes active titles and block text, excluding trash and restoring it transactionally', () => {
    const database = new NotebookDatabase(':memory:')
    databases.push(database)
    const service = new NotebookService(database)
    const notebook = service.createNotebook('Cell biology')
    const page = service.createPage(notebook.id, 'Mitochondria')
    const note = service.createNote(page.id, 'Energy')
    const block = service.createBlock(note.id, 'explanation', { text: 'ATP is produced in mitochondria.' })

    expect(service.search('mitochondria').map(({ entityId }) => entityId)).toEqual(expect.arrayContaining([page.id, block.id]))
    const operation = service.moveToTrash('block', block.id)
    expect(service.search('ATP')).toEqual([])
    service.restoreFromTrash('block', block.id, operation.deletionOperationId)
    expect(service.search('ATP')).toEqual([expect.objectContaining({ entityId: block.id, entityType: 'block' })])
  })

  it('returns page workspace notes in stable 50-note cursor pages', () => {
    const database = new NotebookDatabase(':memory:')
    databases.push(database)
    const service = new NotebookService(database)
    const notebook = service.createNotebook('Research')
    const page = service.createPage(notebook.id, 'Long page')
    let lastNote = service.createNote(page.id, 'Note 0')
    for (let index = 1; index < 55; index += 1) lastNote = service.createNote(page.id, `Note ${index}`)
    service.createBlock(lastNote.id, 'text', { text: 'needle beyond first page' })

    const first = service.getPageWorkspace(page.id)
    expect(first.notes).toHaveLength(50)
    expect(first.nextCursor).toBe('49')
    const second = service.getPageWorkspace(page.id, first.nextCursor ?? undefined)
    expect(second.notes).toHaveLength(5)
    expect(second.notes[0].title).toBe('Note 50')
    expect(second.nextCursor).toBeNull()
    expect(service.search('needle')[0].notePosition).toBe(54)
  })

  it('persists managed assets outside SQLite and protects referenced files from cleanup', () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-notebook-assets-test-'))
    const database = new NotebookDatabase(join(directory, 'database.sqlite')); databases.push(database)
    const service = new NotebookService(database, join(directory, 'assets'))
    const notebook = service.createNotebook('Visual research'); const page = service.createPage(notebook.id, 'Page'); const note = service.createNote(page.id, 'Note')
    const incoming = join(directory, 'diagram.png'); writeFileSync(incoming, Buffer.from('not really a png'))
    const asset = service.importAsset(notebook.id, 'image', incoming)
    expect(asset.relativePath).toMatch(/^assets\/images\//); expect(asset.sha256).toHaveLength(64)
    const block = service.attachAsset(note.id, asset.id, 'image')
    expect(service.getPageWorkspace(page.id).notes[0].blocks[0].data.assetId).toBe(asset.id)
    expect(() => service.removeAsset(asset.id)).toThrow('still referenced')
    expect(service.diagnoseAssets(notebook.id).orphaned).not.toContainEqual(expect.objectContaining({ id: asset.id }))
    service.moveToTrash('block', block.id); service.permanentlyDelete('block', block.id)
    expect(service.diagnoseAssets(notebook.id).orphaned).toContainEqual(expect.objectContaining({ id: asset.id }))
    service.removeAsset(asset.id)
    database.close(); databases.pop(); rmSync(directory, { recursive: true, force: true })
  })

  it('records PDF source text provenance and creates linked Q&A notes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-notebook-source-test-'))
    const database = new NotebookDatabase(join(directory, 'database.sqlite')); databases.push(database)
    const service = new NotebookService(database, join(directory, 'assets'))
    const notebook = service.createNotebook('Research'); const page = service.createPage(notebook.id, 'Paper'); const note = service.createNote(page.id, 'Captures')
    const pdf = join(directory, 'paper.pdf'); writeFileSync(pdf, Buffer.from('%PDF-1.4'))
    const source = service.importPdf(notebook.id, pdf)
    const captured = service.captureSourceText(note.id, source.id, 12, 3, 'A selected finding.')
    expect(service.getBlockSource(captured.id)).toMatchObject({ sourceDocumentId: source.id, pdfPage: 12, printedPage: 3, extractedText: 'A selected finding.' })
    const region = service.captureSourceRegion(note.id, source.id, 12, { x: 10, y: 20, width: 30, height: 40 }, 'data:image/png;base64,iVBORw0KGgo=')
    expect(service.getBlockSource(region.id)).toMatchObject({ selectionType: 'region', pdfPage: 12, bounds: { x: 10, y: 20, width: 30, height: 40 } })
    const qa = service.createQaNote(page.id, source.id, 13, undefined, 'What does this imply?')
    const qaBlocks = service.getPageWorkspace(page.id).notes.find(({ id }) => id === qa.id)?.blocks ?? []
    expect(qaBlocks.map(({ type }) => type)).toEqual(['question', 'answer'])
    expect(service.getBlockSource(qaBlocks[0].id)?.pdfPage).toBe(13)
    database.close(); databases.pop(); rmSync(directory, { recursive: true, force: true })
  })

  it('persists a 16 kHz WAV recording as an audio block and exports a lossless backup', () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-notebook-audio-test-'))
    const database = new NotebookDatabase(join(directory, 'database.sqlite')); databases.push(database)
    const service = new NotebookService(database, join(directory, 'assets'), join(directory, 'config'))
    const notebook = service.createNotebook('Arabic interview'); const page = service.createPage(notebook.id, 'Session'); const note = service.createNote(page.id, 'Recording')
    const wav = Buffer.alloc(44 + 3200); wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(3200, 40)
    const audio = service.saveRecording(note.id, wav.toString('base64'))
    expect(audio.type).toBe('audio'); expect(audio.data.durationMs).toBe(100)
    const destination = join(directory, 'exports'); writeFileSync(join(directory, 'placeholder'), '')
    const result = service.export({ type: 'notebook', notebookId: notebook.id }, 'lossless-json', destination)
    expect(result.manifestPath).toContain('manifest.json')
    const assetId = String(audio.data.assetId)
    expect(() => service.removeAsset(assetId)).toThrow('export record')
    expect(database.connection.prepare('SELECT transcript_text FROM transcription_runs').all()).toEqual([])
    database.close(); databases.pop(); rmSync(directory, { recursive: true, force: true })
  })

  it('imports only fully validated archives and leaves no staged data after rejection', () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-notebook-import-test-'))
    const sourceDb = new NotebookDatabase(join(directory, 'source.sqlite')); databases.push(sourceDb)
    const source = new NotebookService(sourceDb, join(directory, 'source-assets'))
    const notebook = source.createNotebook('Portable'); const page = source.createPage(notebook.id, 'Page'); const note = source.createNote(page.id, 'Note')
    const image = join(directory, 'image.png'); writeFileSync(image, Buffer.from('fixture-bytes'))
    const asset = source.importAsset(notebook.id, 'image', image); source.attachAsset(note.id, asset.id, 'image')
    const exported = source.export({ type: 'notebook', notebookId: notebook.id }, 'lossless-json', join(directory, 'exports'))
    const archivePath = join(dirname(exported.manifestPath), 'notebook.lossless.v1.json')
    const targetDb = new NotebookDatabase(join(directory, 'target.sqlite')); databases.push(targetDb)
    const targetAssets = join(directory, 'target-assets'); const target = new NotebookService(targetDb, targetAssets)
    expect(target.importLossless(archivePath).importedAssets).toBe(1)
    expect(target.listNotebooks()).toHaveLength(1)

    const invalid = JSON.parse(readFileSync(archivePath, 'utf8')) as Record<string, any>
    invalid.assets[0].sha256 = '0'.repeat(64)
    const invalidPath = join(directory, 'invalid.lossless.json'); writeFileSync(invalidPath, JSON.stringify(invalid))
    expect(() => target.importLossless(invalidPath)).toThrow('integrity')
    expect(target.listNotebooks()).toHaveLength(1)
    expect(() => readdirSync(targetAssets).filter((name) => name.includes('.import-'))).not.toThrow()
    expect(readdirSync(targetAssets).filter((name) => name.includes('.import-'))).toEqual([])
    sourceDb.close(); targetDb.close(); databases.splice(databases.indexOf(sourceDb), 1); databases.splice(databases.indexOf(targetDb), 1); rmSync(directory, { recursive: true, force: true })
  })
})
