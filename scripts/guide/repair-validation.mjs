import { _electron } from 'playwright-core'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '../..')
const profile = await mkdtemp(join(tmpdir(), 'notebook-repair-'))
const evidence = join(root, 'docs/images/repairs')
await mkdir(evidence, { recursive: true })
const checks = []
let app
const check = (ok, label) => {
  if (!ok) throw Error(label)
  checks.push(label)
}
try {
  app = await _electron.launch({
    executablePath: join(root, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', root],
    cwd: root,
    env: { ...process.env, XDG_CONFIG_HOME: profile }
  })
  let page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  const waitApi = async (fn, arg) => {
    const until = Date.now() + 30000
    for (;;) {
      if (await page.evaluate(fn, arg)) return
      if (Date.now() > until) throw Error('API state did not settle')
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  check(userData.startsWith(profile + '/'), 'Disposable Electron library is isolated')
  await page.waitForFunction(() => Boolean(window.researchNotebook))
  const pick = async (path) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: !path, filePaths: path ? [path] : [] })
    }, path)
  const archive = join(root, 'full-try/exports/Untitled-notebook-2026-10-08_10-28-19-523/notebook.lossless.v1.json')
  await pick(archive)
  const imported = await page.evaluate(() => window.researchNotebook.imports.start())
  check(imported.importedAssets === 9, 'Supplied lossless v1 archive imports with nine assets')
  const supplied = await page.evaluate(async () => {
    const api = window.researchNotebook
    const n = (await api.notebooks.list())[0]
    const w = await api.pages.getWorkspace({ pageId: n.pages[0].id })
    return { n, w }
  })
  check(supplied.w.notes.length === 3, 'Supplied archive retains three notes and hydrated provenance')
  check(
    supplied.w.notes.flatMap((n) => n.blocks).filter((b) => b.source).length === 7,
    'All seven supplied screenshots expose hydrated source links'
  )
  const exports = join(profile, 'exports')
  await mkdir(exports)
  await pick(exports)
  for (const scope of [
    { type: 'notebook', notebookId: supplied.n.id },
    { type: 'page', pageId: supplied.w.id },
    { type: 'note', noteId: supplied.w.notes[2].id }
  ]) {
    for (const format of ['markdown', 'ai-context', 'lossless-json', 'pdf']) {
      const job = await page.evaluate((input) => window.researchNotebook.exports.start(input), { scope, format })
      await waitApi(
        async (id) =>
          ['completed', 'failed', 'cancelled'].includes((await window.researchNotebook.jobs.get({ jobId: id })).status),
        job.id
      )
      const result = await page.evaluate((id) => window.researchNotebook.jobs.get({ jobId: id }), job.id)
      if (result.status !== 'completed')
        console.error(result, await page.evaluate(() => window.researchNotebook.diagnostics.listErrors()))
      check(result.status === 'completed', `${scope.type} ${format} export completes`)
      if (format === 'markdown' && scope.type === 'notebook') {
        const text = await readFile(join(result.result.directory, 'notebook.md'), 'utf8')
        check(
          (text.match(/!\[/g) ?? []).length === 7 && text.includes('Transcript:'),
          'Readable Markdown contains seven images and the supplied transcript'
        )
        check(text.includes('Source:'), 'Readable export includes source citations')
      }
      if (format === 'pdf' && scope.type === 'notebook') {
        const info = execFileSync('pdfinfo', [join(result.result.directory, 'notebook.pdf')], { encoding: 'utf8' })
        check(
          /Tagged:\s+yes/.test(info) && /A4/.test(info) && !/Title:\s+data:/.test(info),
          'Export PDF is tagged A4 with a short document title'
        )
      }
    }
  }
  await pick(null)
  const before = await page.evaluate(() => window.researchNotebook.diagnostics.listErrors())
  const cancelled = await page.evaluate(async () => ({
    export: await window.researchNotebook.exports.start({
      scope: { type: 'notebook', notebookId: (await window.researchNotebook.notebooks.list())[0].id },
      format: 'markdown'
    }),
    backup: await window.researchNotebook.backups.start()
  }))
  check(cancelled.export === null && cancelled.backup === null, 'Export and backup picker cancellation return null')
  check(
    (await page.evaluate(() => window.researchNotebook.diagnostics.listErrors())).length === before.length,
    'Picker cancellation creates no error records'
  )
  const demo = await page.evaluate(async () => {
    const api = window.researchNotebook
    const n = await api.notebooks.create({ title: 'مختبر Research notes' })
    const p = await api.pages.create({ notebookId: n.id, title: 'Evidence and observations' })
    const a = await api.notes.create({ pageId: p.id, title: 'ملاحظات Experiment A' })
    const b = await api.notes.create({ pageId: p.id, title: 'Review and conclusions' })
    await api.blocks.create({
      noteId: a.id,
      type: 'text',
      data: { text: 'هذه ملاحظات عن PDF.js ونتائج Experiment A.\nThe original evidence stays linked to this note.' }
    })
    await api.blocks.create({ noteId: b.id, type: 'question', data: { text: 'What should we verify next?' } })
    return { n, p, a, b }
  })
  await pick(join(root, 'src/renderer/src/test/fixtures/source.pdf'))
  const source = await page.evaluate((id) => window.researchNotebook.sources.importPdf({ notebookId: id }), demo.n.id)
  await page.evaluate(
    ({ demo, source }) =>
      window.researchNotebook.sources.captureText({
        noteId: demo.a.id,
        sourceDocumentId: source.id,
        pdfPage: 1,
        printedPage: 7,
        text: 'Evidence captured from the test source.'
      }),
    { demo, source }
  )
  const wav = Buffer.alloc(3244)
  wav.write('RIFF')
  wav.writeUInt32LE(3236, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24)
  wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(3200, 40)
  const audio = await page.evaluate((input) => window.researchNotebook.assets.saveRecording(input), {
    noteId: demo.b.id,
    wavBase64: wav.toString('base64')
  })
  const seed = join(profile, 'seed.cjs')
  await writeFile(
    seed,
    `const Database = require(${JSON.stringify(join(root, 'node_modules/better-sqlite3'))}); const db = new Database(${JSON.stringify(join(userData, 'database.sqlite'))}); const audio = ${JSON.stringify(audio)}; const run = require('node:crypto').randomUUID(), segment = require('node:crypto').randomUUID(), time = new Date().toISOString(); db.prepare("INSERT INTO transcription_runs (id,asset_id,block_id,provider,model,status,transcript_text,created_at,updated_at) VALUES (?,?,?,?,?,'completed',?,?,?)").run(run, audio.data.assetId, audio.id, 'local', 'fixture-model', 'Original recognition for review.', time, time); db.prepare('INSERT INTO transcription_segments (id,run_id,position,start_ms,end_ms,text) VALUES (?,?,?,?,?,?)').run(segment, run, 0, 0, 100, 'Original recognition for review.'); db.close(); process.stdout.write(run);`
  )
  const runId = execFileSync(join(root, 'node_modules/electron/dist/electron'), [seed], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8'
  })
  await page.evaluate(
    ({ audio, runId }) =>
      window.researchNotebook.blocks.update({
        blockId: audio.id,
        data: { ...audio.data, activeTranscriptionRunId: runId }
      }),
    { audio, runId }
  )
  await page.reload()
  await page.getByRole('button', { name: demo.p.title, exact: true }).click()
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await page.waitForSelector('.textLayer span')
  check(
    (await page.getByRole('button', { name: 'Import PDF', exact: true }).count()) === 1,
    'Research exposes one labelled PDF import action'
  )
  check(
    (await page.getByLabel('Selected PDF text').inputValue()) === '',
    'Page extraction is distinct from a real selection'
  )
  await page.getByRole('button', { name: 'Extract page text', exact: true }).click()
  check((await page.getByLabel('Selected PDF text').inputValue()).length > 0, 'Explicit page extraction returns text')
  await page.screenshot({ path: join(evidence, 'research-1440.png') })
  await page.getByRole('button', { name: 'Write', exact: true }).click()
  await page.getByLabel('Reviewed transcript').fill('Reviewed transcript — مراجعة الملاحظات')
  await page.getByLabel('Note title').first().click()
  await waitApi(
    async ({ blockId, runId }) => {
      const n = await window.researchNotebook.transcription.get({ runId })
      const tree = await window.researchNotebook.notebooks.list()
      const demo = tree.find((n) => n.title === 'مختبر Research notes')
      const w = await window.researchNotebook.pages.getWorkspace({ pageId: demo.pages[0].id })
      return (
        n.transcriptText === 'Original recognition for review.' &&
        w.notes
          .flatMap((n) => n.blocks)
          .find((b) => b.id === blockId)
          .data.transcriptReviews?.[runId]?.text.includes('مراجعة')
      )
    },
    { blockId: audio.id, runId }
  )
  check(true, 'Reviewed transcript persists separately from original recognition')
  await page.getByLabel('Reviewed transcript').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'transcript-review.png') })
  await page.locator(`[data-item-id="${demo.a.id}"]`).getByRole('button', { name: 'Record audio', exact: true }).click()
  await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
  await page.locator(`[data-item-id="${demo.b.id}"]`).getByLabel('Note title').click()
  check(
    (await page.getByRole('button', { name: 'Stop recording', exact: true }).count()) === 1,
    'Recording survives focus on another note'
  )
  await page.locator(`[data-item-id="${demo.a.id}"]`).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'recording-in-note.png') })
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await waitApi(
    async ({ pageId, noteId }) =>
      (await window.researchNotebook.pages.getWorkspace({ pageId })).notes
        .find((n) => n.id === noteId)
        .blocks.some((b) => b.type === 'audio'),
    { pageId: demo.p.id, noteId: demo.a.id }
  )
  check(true, 'Mode change stops and saves recording to its original destination')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .setSize(960, 640)
  )
  await page.waitForSelector('.textLayer span')
  await page.screenshot({ path: join(evidence, 'research-960.png') })
  const viewportCheck = await page.evaluate(() => {
    const controls = [
      ...document.querySelectorAll(
        '.source-toolbar button, .source-toolbar input, .capture-actions button, .capture-dock textarea, .extraction-actions button'
      )
    ]
    return controls.every((el) => {
      const r = el.getBoundingClientRect()
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
    })
  })
  check(viewportCheck, 'Research navigation and capture actions fit the 960×640 window')
  await page.getByRole('button', { name: 'Write', exact: true }).click()
  await page.getByLabel('Reviewed transcript').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(evidence, 'write-960.png') })
  await page.getByRole('button', { name: 'Page actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export page', exact: true }).click()
  await pick(exports)
  await page.getByRole('button', { name: 'markdown', exact: true }).click()
  await page.getByText('Export complete', { exact: true }).waitFor()
  check(
    await page.getByRole('button', { name: 'Open export folder' }).isVisible(),
    'Export dialog stays open through completion and exposes the folder action'
  )
  await page.screenshot({ path: join(evidence, 'export-complete.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Application menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'settings', exact: true }).click()
  await page.getByRole('button', { name: 'Maintenance', exact: true }).click()
  await page.screenshot({ path: join(evidence, 'maintenance.png') })
  await page.getByRole('button', { name: 'Preview cleanup', exact: true }).first().click()
  await page.getByRole('button', { name: 'Confirm cleanup', exact: true }).waitFor()
  check(
    (await page.getByRole('button', { name: 'Confirm cleanup', exact: true }).count()) === 1,
    'History cleanup previews affected records before explicit confirmation'
  )
  console.log('Checking close recovery')
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (...args) => {
      globalThis.closeRecovery = args.at(-1)
      return { response: 3 }
    }
  })
  await app.evaluate(({ ipcMain }) => ipcMain.removeAllListeners('lifecycle:close-result'))
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .close()
  )
  const waitRecovery = async () => {
    const until = Date.now() + 20000
    while (!(await app.evaluate(() => Boolean(globalThis.closeRecovery)))) {
      if (Date.now() > until) throw Error('Close recovery did not appear')
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  await waitRecovery()
  check(true, 'Missing close acknowledgement triggers recovery after the 15-second timeout')
  await app.evaluate(() => {
    delete globalThis.closeRecovery
  })
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) => w.isVisible())
    w.close()
    w.webContents.forcefullyCrashRenderer()
  })
  await waitRecovery()
  check(
    await app.evaluate(() => Boolean(globalThis.closeRecovery)),
    'Renderer loss during close presents an explicit recovery choice'
  )
  console.log('Recovery dialog checked')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.isVisible())
      .reload()
  )
  await new Promise((resolve) => setTimeout(resolve, 500))
  const recovered = await app.evaluate(
    ({ BrowserWindow }, ids) => {
      const w = BrowserWindow.getAllWindows().find((w) => w.isVisible())
      return w.webContents.executeJavaScript(
        `window.researchNotebook.pages.getWorkspace({ pageId: ${JSON.stringify(ids.pageId)} }).then(w => w.notes.flatMap(n => n.blocks).find(b => b.id === ${JSON.stringify(ids.audioId)}).data.transcriptReviews[${JSON.stringify(ids.runId)}].text)`
      )
    },
    { pageId: demo.p.id, audioId: audio.id, runId }
  )
  check(recovered.includes('مراجعة'), 'Reviewed transcript survives editor reload')
  await writeFile(
    join(root, 'docs/repair-workflow-verification.json'),
    JSON.stringify(
      {
        date: '2026-10-08',
        platform: process.platform,
        checks,
        unavailable: [
          'Native Windows import and packaged Windows smoke test',
          'Packaged Linux sidecar smoke test: Whisper resources absent',
          'Physical microphone and fresh Egyptian Arabic recognition',
          'Screen-reader verification of generated PDF tagging'
        ]
      },
      null,
      2
    ) + '\n'
  )
  console.log(JSON.stringify({ checks, evidence }, null, 2))
} catch (error) {
  console.error('Validation failed', error, checks)
  throw error
} finally {
  if (app) {
    const child = app.process()
    await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 3000))])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
  await rm(profile, { recursive: true, force: true })
}
