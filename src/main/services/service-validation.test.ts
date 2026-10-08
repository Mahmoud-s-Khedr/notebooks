import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { TestLibrary, validWav, writeFixture, waitForJob } from '../test-support'

let library: TestLibrary
beforeEach(() => {
  library = new TestLibrary()
})
afterEach(() => library.close())
const fixture = () => {
  const s = library.service
  const notebook = s.createNotebook('Research')
  const page = s.createPage(notebook.id, 'Topic')
  const note = s.createNote(page.id, 'Note')
  const block = s.createBlock(note.id, 'text', { text: 'Thought' })
  return { s, notebook, page, note, block }
}
describe('disk-backed validation and state transitions', () => {
  it('rejects updates to missing or deleted entities without modifying active content', () => {
    const { s, notebook, page, note, block } = fixture()
    const updates = [
      () => s.updateNotebook(notebook.id, 'changed'),
      () => s.updatePage(page.id, 'changed'),
      () => s.updateNote(note.id, 'changed'),
      () => s.updateBlock(block.id, { text: 'changed' })
    ]
    s.moveToTrash('notebook', notebook.id)
    for (const update of updates) expect(update).toThrow('no longer available')
    expect(() => s.getPageWorkspace(page.id)).toThrow('no longer available')
    expect(() => s.createPage(notebook.id, 'new')).toThrow('no longer available')
    expect(() => s.createNote(page.id, 'new')).toThrow('no longer available')
    expect(() => s.createBlock(note.id, 'text')).toThrow('no longer available')
    expect(() => s.getPageWorkspace('missing')).toThrow('does not exist')
    expect(s.listNotebooks()).toEqual([])
  })
  it('validates cursors, exact reorder membership and block conversion', () => {
    const { s, page, note, block } = fixture()
    const second = s.createBlock(note.id, 'question', { text: 'Why?' })
    for (const order of [[block.id], [block.id, block.id], [block.id, 'foreign']])
      expect(() => s.reorderBlocks(note.id, order)).toThrow('submitted order')
    expect(() => s.getPageWorkspace(page.id, '-1')).toThrow('cursor is invalid')
    expect(s.updateBlockType(block.id, 'quote')).toMatchObject({ type: 'quote', data: { text: 'Thought' } })
    const file = s.createBlock(note.id, 'file', {})
    expect(() => s.updateBlockType(file.id, 'text')).toThrow('Only text-based')
    expect(s.getPageWorkspace(page.id).notes[0].blocks.map((b) => b.id)).toEqual([block.id, second.id, file.id])
  })
  it('restores each hierarchy level and rejects stale trash operation IDs and active deletion', () => {
    const { s, notebook, page, note, block } = fixture()
    for (const [type, id] of [
      ['block', block.id],
      ['note', note.id],
      ['page', page.id],
      ['notebook', notebook.id]
    ] as const) {
      expect(() => s.permanentlyDelete(type, id)).toThrow('no longer available')
      const operation = s.moveToTrash(type, id)
      expect(() => s.restoreFromTrash(type, id, crypto.randomUUID())).toThrow()
      s.restoreFromTrash(type, id, operation.deletionOperationId)
      expect(s.getPageWorkspace(page.id).notes[0].blocks[0].id).toBe(block.id)
    }
    s.moveToTrash('block', block.id)
    s.moveToTrash('note', note.id)
    s.moveToTrash('page', page.id)
    s.moveToTrash('notebook', notebook.id)
    s.emptyTrash()
    expect(s.listTrash()).toEqual([])
    expect(library.database.connection.prepare('SELECT * FROM blocks').all()).toEqual([])
  })
  it('rejects restoration when the parent is still trashed', () => {
    const { s, notebook, page, note, block } = fixture()
    const deletedBlock = s.moveToTrash('block', block.id)
    const deletedNote = s.moveToTrash('note', note.id)
    const deletedPage = s.moveToTrash('page', page.id)
    s.moveToTrash('notebook', notebook.id)
    expect(() => s.restoreFromTrash('block', block.id, deletedBlock.deletionOperationId)).toThrow()
    expect(() => s.restoreFromTrash('note', note.id, deletedNote.deletionOperationId)).toThrow()
    expect(() => s.restoreFromTrash('page', page.id, deletedPage.deletionOperationId)).toThrow()
    expect(s.listTrash()).toHaveLength(4)
  })
  it('validates relation endpoints, removes relations and updates searchable titles', () => {
    const { s, notebook, page, note, block } = fixture()
    expect(() => s.createRelation(block.id, block.id, 'explains')).toThrow()
    expect(() => s.createRelation(block.id, 'missing', 'explains')).toThrow()
    const second = s.createBlock(note.id, 'answer', { text: 'Answer' })
    const relation = s.createRelation(block.id, second.id, 'explains')
    s.removeRelation(relation.id)
    expect(s.listRelations(block.id)).toEqual([])
    s.updateNotebook(notebook.id, 'Astronomy')
    s.updatePage(page.id, 'Astronomy')
    s.updateNote(note.id, 'Astronomy')
    expect(
      s
        .search('Astronomy')
        .map((r) => r.entityType)
        .sort()
    ).toEqual(['note', 'notebook', 'page'])
    expect(s.search('   ')).toEqual([])
  })
  it('validates model and credential state without downloads', async () => {
    const { s, note } = fixture()
    const audio = s.saveRecording(note.id, validWav().toString('base64'))
    expect(() => s.setOpenRouterKey('x'.repeat(1001))).toThrow('too long')
    s.setOpenRouterKey('session-key')
    expect(s.transcriptionSettings().openRouterConfigured).toBe(true)
    s.removeOpenRouterKey()
    expect(s.transcriptionSettings().openRouterConfigured).toBe(false)
    expect(() => s.setDefaultWhisperModel('ggml-tiny.bin')).toThrow('Download this')
    expect(() => s.removeWhisperModel('ggml-small.bin')).toThrow('another installed default')
    expect(() => s.cancelWhisperModelDownload('ggml-tiny.bin')).toThrow('No download is running')
    expect(() => s.downloadWhisperModel('unknown')).toThrow('Unknown Whisper model')
    writeFileSync(join(library.config, 'whisper-models', 'ggml-tiny.bin'), 'installed')
    expect(() => s.downloadWhisperModel('ggml-tiny.bin')).toThrow('already installed')
    s.setDefaultWhisperModel('ggml-tiny.bin')
    s.cancelWhisperModelDownload('ggml-tiny.bin')
    s.removeWhisperModel('ggml-base.bin')
    expect(s.transcriptionSettings().selectedLocalModel?.id).toBe('ggml-tiny.bin')
    await expect(s.createTranscription(audio.id, 'local')).rejects.toThrow('sidecar is missing')
  })
  it('reports missing assets and source validation failures without partial captures', () => {
    const { s, notebook, page, note, block } = fixture()
    expect(() => s.assetDataUrl('missing')).toThrow()
    expect(s.thumbnailDataUrl('missing', 32, 32)).toBeNull()
    expect(() => s.removeAsset('missing')).toThrow()
    const pdf = s.importPdf(notebook.id, writeFixture(library.root, 'source.pdf', '%PDF fixture'))
    expect(s.listSources(notebook.id)).toEqual([pdf])
    expect(s.getBlockSource(block.id)).toBeNull()
    expect(() => s.captureSourceText(note.id, 'missing', 1, undefined, 'text')).toThrow()
    expect(() => s.captureSourceRegion(note.id, pdf.id, 1, { x: 0, y: 0, width: 1, height: 1 }, 'invalid')).toThrow()
    const other = s.createNotebook('Other')
    const otherPage = s.createPage(other.id, 'Other')
    const otherNote = s.createNote(otherPage.id, 'Other')
    expect(() => s.captureSourceText(otherNote.id, pdf.id, 1, undefined, 'text')).toThrow('must belong')
    expect(() => s.createQaNote(otherPage.id, pdf.id, 1, undefined, 'text')).toThrow('must belong')
    expect(s.getPageWorkspace(page.id).notes).toHaveLength(1)
  })
  it('tracks an integrity scan and rejects output folders for non-export jobs', async () => {
    const { s, notebook } = fixture()
    const finished = await waitForJob(s, s.startIntegrityScan(notebook.id))
    expect(finished.status).toBe('completed')
    expect(() => s.exportDirectory(finished.id)).toThrow('no completed output folder')
    expect(s.getJob(finished.id)).toMatchObject({ kind: 'asset-integrity', status: 'completed' })
    expect(s.diagnostics()).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: 'asset-integrity', outcome: 'completed' })])
    )
  })
})
