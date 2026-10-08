import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { TestLibrary, validWav, writeFixture } from '../test-support'

const libraries: TestLibrary[] = []
const library = () => {
  const value = new TestLibrary()
  libraries.push(value)
  return value
}
afterEach(() => libraries.splice(0).forEach((value) => value.close()))

function fixture() {
  const value = library()
  const notebook = value.service.createNotebook('Integrity')
  const page = value.service.createPage(notebook.id, 'Page')
  const note = value.service.createNote(page.id, 'Note')
  return { ...value, value, notebook, page, note }
}

describe('duplicated content integrity', () => {
  it('preserves shared attachments, provenance, transcription history and internal relations through export/import', () => {
    const { value, notebook, page, note } = fixture()
    const s = value.service,
      db = value.database.connection
    const image = s.importAsset(notebook.id, 'image', writeFixture(value.root, 'image.png', 'image bytes'))
    const imageBlock = s.attachAsset(note.id, image.id, 'image')
    const pdf = s.importPdf(notebook.id, writeFixture(value.root, 'paper.pdf', '%PDF-1.4 fixture'))
    const citation = s.captureSourceText(note.id, pdf.id, 2, 7, 'Evidence')
    const audio = s.saveRecording(note.id, validWav().toString('base64'))
    const runId = randomUUID(),
      time = new Date().toISOString()
    db.prepare(
      "INSERT INTO transcription_runs (id,asset_id,block_id,provider,model,status,transcript_text,created_at,updated_at) VALUES (?,?,?,?,?,'completed',?,?,?)"
    ).run(runId, audio.data.assetId, audio.id, 'local', 'test', 'Words', time, time)
    db.prepare('INSERT INTO transcription_segments (id,run_id,position,start_ms,end_ms,text) VALUES (?,?,?,?,?,?)').run(
      randomUUID(),
      runId,
      0,
      0,
      100,
      'Words'
    )
    db.prepare("UPDATE blocks SET data_json=json_set(data_json,'$.activeTranscriptionRunId',?) WHERE id=?").run(
      runId,
      audio.id
    )
    s.createRelation(citation.id, imageBlock.id, 'comments_on')
    const single = s.duplicateBlock(imageBlock.id)
    expect(db.prepare('SELECT asset_id FROM asset_references WHERE block_id=?').get(single.id)).toEqual({
      asset_id: image.id
    })
    const copy = s.duplicateNote(note.id)
    const copiedBlocks = s.getPageWorkspace(page.id).notes.find((entry) => entry.id === copy.id)!.blocks
    const copiedAudio = copiedBlocks.find((block) => block.type === 'audio')!
    const copiedRun = String(copiedAudio.data.activeTranscriptionRunId)
    expect(copiedRun).not.toBe(runId)
    expect(db.prepare('SELECT block_id,transcript_text FROM transcription_runs WHERE id=?').get(copiedRun)).toEqual({
      block_id: copiedAudio.id,
      transcript_text: 'Words'
    })
    expect(db.prepare('SELECT text FROM transcription_segments WHERE run_id=?').get(copiedRun)).toEqual({
      text: 'Words'
    })
    const copiedCitation = copiedBlocks.find((block) => block.type === 'source_text')!
    expect(db.prepare('SELECT source_document_id FROM block_sources WHERE block_id=?').get(copiedCitation.id)).toEqual({
      source_document_id: pdf.id
    })
    expect(s.listRelations(copiedCitation.id)).toHaveLength(1)
    expect(s.listRelations(copiedCitation.id)[0].toBlockId).not.toBe(imageBlock.id)
    s.moveToTrash('note', note.id)
    s.permanentlyDelete('note', note.id)
    expect(() => s.removeAsset(image.id)).toThrow('still referenced')
    const out = s.export({ type: 'note', noteId: copy.id }, 'lossless-json', join(value.root, 'exports'))
    const target = library()
    expect(target.service.importLossless(join(out.directory, 'notebook.lossless.v1.json')).importedAssets).toBe(3)
  })

  it('rolls back the entire duplicate if copying references fails', () => {
    const { value, notebook, page, note } = fixture()
    const image = value.service.importAsset(notebook.id, 'image', writeFixture(value.root, 'x.png', 'bytes'))
    const original = value.service.attachAsset(note.id, image.id, 'image')
    value.database.connection.exec(
      "CREATE TRIGGER reject_copy BEFORE INSERT ON asset_references BEGIN SELECT RAISE(ABORT,'copy failure'); END"
    )
    expect(() => value.service.duplicateBlock(original.id)).toThrow('copy failure')
    expect(() => value.service.duplicateNote(note.id)).toThrow('copy failure')
    expect(value.service.getPageWorkspace(page.id).notes).toHaveLength(1)
    expect(value.service.getPageWorkspace(page.id).notes[0].blocks).toHaveLength(1)
  })
})

describe('archive ordering', () => {
  it('round trips notebook, page and note scopes with gaps without changing live positions', () => {
    const { value, notebook, page, note } = fixture()
    const laterPage = value.service.createPage(notebook.id, 'Later')
    const first = value.service.createNote(laterPage.id, 'First')
    const laterNote = value.service.createNote(laterPage.id, 'Later')
    const deleted = value.service.createBlock(laterNote.id, 'text', { text: 'Deleted' })
    const kept = value.service.createBlock(laterNote.id, 'text', { text: 'Kept' })
    value.service.moveToTrash('page', page.id)
    value.service.moveToTrash('note', first.id)
    value.service.moveToTrash('block', deleted.id)
    for (const scope of [
      { type: 'notebook' as const, notebookId: notebook.id },
      { type: 'page' as const, pageId: laterPage.id },
      { type: 'note' as const, noteId: laterNote.id }
    ]) {
      const out = value.service.export(scope, 'lossless-json', join(value.root, 'exports'))
      const archive = join(out.directory, 'notebook.lossless.v1.json')
      const data = JSON.parse(readFileSync(archive, 'utf8'))
      expect(data.pages.map((row: { position: number }) => row.position)).toEqual([0])
      expect(data.notes.map((row: { position: number }) => row.position)).toEqual([0])
      expect(data.blocks.map((row: { position: number }) => row.position)).toEqual([0])
      expect(library().service.importLossless(archive).notebook.title).toBe('Integrity')
    }
    expect(value.database.connection.prepare('SELECT position FROM blocks WHERE id=?').get(kept.id)).toEqual({
      position: 1
    })
    expect(note.position).toBe(0)
  })
})

describe('reorder with retained Trash', () => {
  it('preserves active order through repeated reorder/delete/restore cycles', () => {
    const { value, page, note } = fixture(),
      s = value.service
    const a = s.createBlock(note.id, 'text'),
      b = s.createBlock(note.id, 'text'),
      c = s.createBlock(note.id, 'text')
    const ids = () => s.getPageWorkspace(page.id).notes[0].blocks.map((block) => block.id)
    const trash = s.moveToTrash('block', a.id)
    s.reorderBlocks(note.id, [c.id, b.id])
    expect(ids()).toEqual([c.id, b.id])
    s.restoreFromTrash('block', a.id, trash.deletionOperationId)
    expect(ids().filter((id) => id !== a.id)).toEqual([c.id, b.id])
    const again = s.moveToTrash('block', b.id)
    s.reorderBlocks(note.id, [c.id, a.id])
    s.restoreFromTrash('block', b.id, again.deletionOperationId)
    expect(ids().filter((id) => id !== b.id)).toEqual([c.id, a.id])
    const before = ids()
    value.database.connection.exec(
      `CREATE TRIGGER reject_reorder BEFORE UPDATE OF position ON blocks WHEN NEW.id='${a.id}' BEGIN SELECT RAISE(ABORT,'reorder failure'); END`
    )
    expect(() => s.reorderBlocks(note.id, [...before].reverse())).toThrow('reorder failure')
    expect(ids()).toEqual(before)
  })
})
