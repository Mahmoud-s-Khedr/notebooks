import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { blockTypes, relationTypes, textBlockTypes } from '../../shared/domain'
import { NotebookService } from '../services/notebook-service'

const titleSchema = z.string().trim().min(1, 'A title is required.').max(500, 'Titles must be 500 characters or fewer.')
const idSchema = z.string().uuid('Expected a valid item ID.')
const recordSchema = z.record(z.string(), z.unknown())
const entityTypeSchema = z.enum(['notebook', 'page', 'note', 'block'])
const cursorSchema = z.string().regex(/^\d+$/, 'Expected a valid page cursor.').max(20)
const searchSchema = z.string().trim().min(1, 'Enter something to search for.').max(500, 'Searches must be 500 characters or fewer.')
const assetKindSchema = z.enum(['image', 'screenshot', 'audio', 'file'])
const pageNumber = z.number().int().positive()
const boundsSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() }).strict()
const transcriptionProviderSchema = z.enum(['local', 'openrouter'])
const languageSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/).max(10)
const exportScopeSchema = z.discriminatedUnion('type', [z.object({ type: z.literal('notebook'), notebookId: idSchema }).strict(), z.object({ type: z.literal('page'), pageId: idSchema }).strict(), z.object({ type: z.literal('note'), noteId: idSchema }).strict()])

function register<Schema extends z.ZodType>(channel: string, schema: Schema, handler: (input: z.output<Schema>) => unknown): void {
  ipcMain.handle(channel, (_event, input: unknown) => handler(schema.parse(input)))
}

export function registerNotebookIpc(service: NotebookService): void {
  register('notebooks:list', z.undefined(), () => service.listNotebooks())
  register('notebooks:create', z.object({ title: titleSchema }).strict(), (input) => service.createNotebook(input.title))
  register('notebooks:update', z.object({ notebookId: idSchema, title: titleSchema }).strict(), (input) => service.updateNotebook(input.notebookId, input.title))

  register('pages:create', z.object({ notebookId: idSchema, title: titleSchema }).strict(), (input) => service.createPage(input.notebookId, input.title))
  register('pages:update', z.object({ pageId: idSchema, title: titleSchema }).strict(), (input) => service.updatePage(input.pageId, input.title))
  register('pages:get-workspace', z.object({ pageId: idSchema, cursor: cursorSchema.optional() }).strict(), (input) => service.getPageWorkspace(input.pageId, input.cursor))

  register('notes:create', z.object({ pageId: idSchema, title: titleSchema }).strict(), (input) => service.createNote(input.pageId, input.title))
  register('notes:update', z.object({ noteId: idSchema, title: titleSchema }).strict(), (input) => service.updateNote(input.noteId, input.title))
  register('notes:duplicate', z.object({ noteId: idSchema }).strict(), (input) => service.duplicateNote(input.noteId))

  register('blocks:create', z.object({ noteId: idSchema, type: z.enum(blockTypes), data: recordSchema.optional() }).strict(), (input) => service.createBlock(input.noteId, input.type, input.data))
  register('blocks:update', z.object({ blockId: idSchema, data: recordSchema }).strict(), (input) => service.updateBlock(input.blockId, input.data))
  register('blocks:update-type', z.object({ blockId: idSchema, type: z.enum(textBlockTypes) }).strict(), (input) => service.updateBlockType(input.blockId, input.type))
  register('blocks:duplicate', z.object({ blockId: idSchema }).strict(), (input) => service.duplicateBlock(input.blockId))
  register('blocks:reorder', z.object({ noteId: idSchema, blockIds: z.array(idSchema) }).strict(), (input) => service.reorderBlocks(input.noteId, input.blockIds))

  register('relations:list', z.object({ blockId: idSchema }).strict(), (input) => service.listRelations(input.blockId))
  register('relations:create', z.object({ fromBlockId: idSchema, toBlockId: idSchema, relationType: z.enum(relationTypes) }).strict(), (input) => service.createRelation(input.fromBlockId, input.toBlockId, input.relationType))
  register('relations:remove', z.object({ relationId: idSchema }).strict(), (input) => service.removeRelation(input.relationId))

  register('trash:list', z.undefined(), () => service.listTrash())
  register('trash:move', z.object({ entityType: entityTypeSchema, id: idSchema }).strict(), (input) => service.moveToTrash(input.entityType, input.id))
  register('trash:restore', z.object({ entityType: entityTypeSchema, id: idSchema, deletionOperationId: idSchema }).strict(), (input) => service.restoreFromTrash(input.entityType, input.id, input.deletionOperationId))
  register('trash:permanently-delete', z.object({ entityType: entityTypeSchema, id: idSchema }).strict(), (input) => service.permanentlyDelete(input.entityType, input.id))
  register('trash:empty', z.undefined(), () => service.emptyTrash())
  register('search', z.object({ query: searchSchema }).strict(), (input) => service.search(input.query))

  register('assets:import', z.object({ notebookId: idSchema, kind: assetKindSchema }).strict(), async (input) => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile'] })
    return picked.canceled || !picked.filePaths[0] ? null : service.importAsset(input.notebookId, input.kind, picked.filePaths[0])
  })
  register('assets:list', z.object({ notebookId: idSchema }).strict(), (input) => service.listAssets(input.notebookId))
  register('assets:data-url', z.object({ assetId: idSchema }).strict(), (input) => service.assetDataUrl(input.assetId))
  register('assets:attach', z.object({ noteId: idSchema, assetId: idSchema, type: z.enum(['image', 'screenshot', 'audio', 'file']) }).strict(), (input) => service.attachAsset(input.noteId, input.assetId, input.type))
  register('assets:diagnostics', z.object({ notebookId: idSchema }).strict(), (input) => service.diagnoseAssets(input.notebookId))
  register('assets:remove', z.object({ assetId: idSchema }).strict(), (input) => service.removeAsset(input.assetId))
  register('assets:save-recording', z.object({ noteId: idSchema, wavBase64: z.string().min(60).max(80_000_000), filename: z.string().max(180).optional() }).strict(), (input) => service.saveRecording(input.noteId, input.wavBase64, input.filename))
  register('assets:request-thumbnail', z.object({ assetId: idSchema, width: z.number().int().min(32).max(2048), height: z.number().int().min(32).max(2048) }).strict(), (input) => service.requestThumbnail(input.assetId, input.width, input.height))
  register('assets:thumbnail-data-url', z.object({ assetId: idSchema, width: z.number().int().min(32).max(2048), height: z.number().int().min(32).max(2048) }).strict(), (input) => service.thumbnailDataUrl(input.assetId, input.width, input.height))

  register('transcription:create', z.object({ blockId: idSchema, provider: transcriptionProviderSchema, model: z.string().max(120).optional(), language: languageSchema.optional() }).strict(), (input) => service.createTranscription(input.blockId, input.provider, input.model, input.language))
  register('transcription:get', z.object({ runId: idSchema }).strict(), (input) => service.getTranscription(input.runId))
  register('transcription:list', z.object({ blockId: idSchema }).strict(), (input) => service.listTranscriptions(input.blockId))
  register('transcription:retry', z.object({ runId: idSchema }).strict(), (input) => service.retryTranscription(input.runId))
  register('settings:transcription', z.undefined(), () => service.transcriptionSettings())
  register('settings:openrouter-key', z.object({ key: z.string().min(1).max(1000) }).strict(), (input) => service.setOpenRouterKey(input.key))
  register('exports:start', z.object({ scope: exportScopeSchema, format: z.enum(['markdown', 'lossless-json', 'ai-context', 'pdf']) }).strict(), async (input) => {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose export folder' })
    if (picked.canceled || !picked.filePaths[0]) throw new Error('Export was cancelled.')
    return service.startExport(input.scope, input.format, picked.filePaths[0])
  })
  register('jobs:list', z.undefined(), () => service.listJobs())
  register('jobs:cancel', z.object({ jobId: idSchema }).strict(), (input) => service.cancelJob(input.jobId))
  register('jobs:retry', z.object({ jobId: idSchema }).strict(), (input) => service.retryJob(input.jobId))
  register('backups:start', z.undefined(), async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose backup folder' })
    if (picked.canceled || !picked.filePaths[0]) throw new Error('Backup was cancelled.')
    return service.startBackup(picked.filePaths[0])
  })
  register('diagnostics:list', z.undefined(), () => service.diagnostics())
  register('diagnostics:export', z.undefined(), async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], title: 'Choose diagnostics export folder' })
    return picked.canceled || !picked.filePaths[0] ? null : service.exportDiagnostics(picked.filePaths[0])
  })
  register('imports:start', z.undefined(), async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Lossless notebook backup', extensions: ['json'] }] })
    return picked.canceled || !picked.filePaths[0] ? null : service.importLossless(picked.filePaths[0])
  })

  register('sources:import-pdf', z.object({ notebookId: idSchema }).strict(), async (input) => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }] })
    return picked.canceled || !picked.filePaths[0] ? null : service.importPdf(input.notebookId, picked.filePaths[0])
  })
  register('sources:list', z.object({ notebookId: idSchema }).strict(), (input) => service.listSources(input.notebookId))
  register('sources:get-block-source', z.object({ blockId: idSchema }).strict(), (input) => service.getBlockSource(input.blockId))
  register('sources:capture-text', z.object({ noteId: idSchema, sourceDocumentId: idSchema, pdfPage: pageNumber, printedPage: pageNumber.optional(), text: z.string().max(200000), selectionType: z.literal('text').optional() }).strict(), (input) => service.captureSourceText(input.noteId, input.sourceDocumentId, input.pdfPage, input.printedPage, input.text))
  register('sources:capture-region', z.object({ noteId: idSchema, sourceDocumentId: idSchema, pdfPage: pageNumber, bounds: boundsSchema, imageDataUrl: z.string().max(25_000_000) }).strict(), (input) => service.captureSourceRegion(input.noteId, input.sourceDocumentId, input.pdfPage, input.bounds, input.imageDataUrl))
  register('sources:create-qa-note', z.object({ pageId: idSchema, sourceDocumentId: idSchema, pdfPage: pageNumber, printedPage: pageNumber.optional(), text: z.string().min(1).max(200000) }).strict(), (input) => service.createQaNote(input.pageId, input.sourceDocumentId, input.pdfPage, input.printedPage, input.text))
}
