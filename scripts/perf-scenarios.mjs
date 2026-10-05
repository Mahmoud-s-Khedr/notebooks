/** Repeatable Electron benchmark. Every run uses a disposable library and five samples. */
import { _electron } from './guide/node_modules/playwright-core/index.mjs'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir, cpus } from 'node:os'
import { join, resolve } from 'node:path'
const root = resolve('.')
const appRoot = process.env.PERF_APP_ROOT || root
const isolated = process.env.PERF_LIBRARY_ROOT || (await mkdtemp(join(tmpdir(), 'notebook-performance-')))
if (!resolve(isolated).startsWith(join(tmpdir(), 'notebook-performance-')))
  throw Error('Use a disposable benchmark profile under the temporary performance prefix.')
const image = join(isolated, 'image.png')
await writeFile(
  image,
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64')
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
const audio = join(isolated, 'audio.wav')
await writeFile(audio, wav)
const pdf = join(root, 'src/renderer/src/test/fixtures/source.pdf')
const scenarios = [
  { name: 'large-page', notes: 1, blocks: 4000 },
  { name: 'paginated-notes', notes: 200, blocks: 8 },
  { name: 'mixed-assets', notes: 150, blocks: 2 },
  { name: 'active-search', notes: 100, blocks: 30 }
]
const median = (samples) =>
  Object.fromEntries(
    Object.keys(samples[0]).map((k) => [
      k,
      samples[0][k] === null ? null : samples.map((s) => s[k]).sort((a, b) => a - b)[2]
    ])
  )
const app = await _electron.launch({
  executablePath: join(root, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', appRoot],
  cwd: root,
  env: { ...process.env, XDG_CONFIG_HOME: isolated }
})
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(60000)
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  if (!userData.startsWith(isolated + '/')) throw Error('Benchmark isolation failed')
  await page.waitForFunction(() => Boolean(window.researchNotebook))
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => globalThis.perfPicker ?? { canceled: true, filePaths: [] }
  })
  const pick = (path) =>
    app.evaluate((_, path) => {
      globalThis.perfPicker = { canceled: false, filePaths: [path] }
    }, path)
  const results = []
  const fixtures = []
  for (const scenario of scenarios) {
    console.log('Preparing', scenario.name)
    let existing = false
    const ids = await page.evaluate(async (s) => {
      const api = window.researchNotebook
      const prior = (await api.notebooks.list()).find((n) => n.title === s.name)
      if (prior) {
        let ws = await api.pages.getWorkspace({ pageId: prior.pages[0].id })
        const notes = ws.notes.map((n) => n.id)
        while (ws.nextCursor) {
          ws = await api.pages.getWorkspace({ pageId: ws.id, cursor: ws.nextCursor })
          notes.push(...ws.notes.map((n) => n.id))
        }
        if (notes.length !== s.notes) throw Error('Unexpected retained fixture size')
        return { pageId: ws.id, notebookId: prior.id, notes, existing: true }
      }
      const n = await api.notebooks.create({ title: s.name })
      const p = await api.pages.create({ notebookId: n.id, title: s.name })
      const notes = []
      for (let i = 0; i < s.notes; i++) {
        const note = await api.notes.create({ pageId: p.id, title: `Fixture ${i}` })
        notes.push(note.id)
        for (let j = 0; j < s.blocks; j++)
          await api.blocks.create({ noteId: note.id, type: 'text', data: { text: `Evidence fixture ${i} ${j}` } })
      }
      return { pageId: p.id, notebookId: n.id, notes }
    }, scenario)
    existing = Boolean(ids.existing)
    if (scenario.name === 'mixed-assets' && !existing)
      for (let i = 0; i < 150; i++) {
        const kind = i % 3 === 0 ? 'image' : i % 3 === 1 ? 'audio' : 'file'
        await pick(kind === 'image' ? image : kind === 'audio' ? audio : pdf)
        await page.evaluate(
          async ({ ids, i, kind }) => {
            const api = window.researchNotebook
            const asset = await api.assets.import({ notebookId: ids.notebookId, kind })
            await api.assets.attach({ noteId: ids.notes[i], assetId: asset.id, type: kind })
          },
          { ids, i, kind }
        )
      }
    fixtures.push({ ...scenario, ...ids })
  }
  // Retained profiles are normalized so recording samples always start without clips.
  await page.evaluate(async (id) => {
    const api = window.researchNotebook
    const ws = await api.pages.getWorkspace({ pageId: id })
    for (const block of ws.notes.flatMap((n) => n.blocks).filter((b) => b.type === 'audio')) {
      await api.trash.move({ entityType: 'block', id: block.id })
      await api.trash.permanentlyDelete({ entityType: 'block', id: block.id })
      await api.assets.remove({ assetId: block.data.assetId })
    }
  }, fixtures[1].pageId)
  await page.addInitScript(() => {
    window.perfLongTasks = []
    new PerformanceObserver((list) => window.perfLongTasks.push(...list.getEntries().map((e) => e.duration))).observe({
      type: 'longtask',
      buffered: true
    })
  })
  const counted = await app.evaluate(({ ipcMain }) => {
    if (!ipcMain._invokeHandlers) return false
    globalThis.perfCalls = 0
    for (const [channel, handler] of ipcMain._invokeHandlers)
      ipcMain._invokeHandlers.set(channel, (...args) => {
        globalThis.perfCalls++
        return handler(...args)
      })
    return true
  })
  const session = await page.context().newCDPSession(page)
  const frames = async () =>
    page.evaluate(async () => {
      const times = []
      let previous = performance.now()
      for (let i = 0; i < 20; i++) {
        await new Promise(requestAnimationFrame)
        const now = performance.now()
        times.push(now - previous)
        previous = now
        const pane = document.querySelector('.write-layout, .editor-pane')
        if (pane) pane.scrollTop += 200
      }
      return times.sort((a, b) => a - b)[18]
    })
  for (const fixture of fixtures) {
    const samples = []
    for (let run = 0; run < 5; run++) {
      await page.reload()
      await page.getByRole('button', { name: fixture.name, exact: true }).waitFor()
      if (counted)
        await app.evaluate(() => {
          globalThis.perfCalls = 0
        })
      await page.evaluate(() => {
        window.perfLongTasks = []
      })
      const start = Date.now()
      await page.getByRole('button', { name: fixture.name, exact: true }).click()
      await page.locator('.note-document').first().waitFor()
      await page.evaluate(() => new Promise(requestAnimationFrame))
      const workspaceRenderMs = Date.now() - start
      const api = await page.evaluate(async (id) => {
        const start = performance.now()
        const ws = await window.researchNotebook.pages.getWorkspace({ pageId: id })
        const workspaceMs = performance.now() - start
        const p = performance.now()
        if (ws.nextCursor) await window.researchNotebook.pages.getWorkspace({ pageId: id, cursor: ws.nextCursor })
        const paginationMs = ws.nextCursor ? performance.now() - p : null
        const q = performance.now()
        await window.researchNotebook.search({ query: 'Evidence' })
        return { workspaceMs, paginationMs, searchMs: performance.now() - q }
      }, fixture.pageId)
      const scrollFrameP95Ms = await frames()
      const heap = await session.send('Runtime.getHeapUsage')
      const long = await page.evaluate(() => ({
        longTasks: window.perfLongTasks.length,
        longTaskMs: window.perfLongTasks.reduce((a, b) => a + b, 0)
      }))
      const ipcCalls = counted ? await app.evaluate(() => globalThis.perfCalls) : null
      samples.push({ ...api, workspaceRenderMs, scrollFrameP95Ms, heapBytes: heap.usedSize, ...long, ipcCalls })
    }
    results.push({ scenario: fixture.name, samples, medians: median(samples) })
    console.log('Measured', fixture.name)
  }
  const target = fixtures[1]
  await page.reload()
  await page.getByRole('button', { name: target.name, exact: true }).click()
  await pick(pdf)
  await page.evaluate(async (id) => {
    const api = window.researchNotebook
    if (!(await api.sources.list({ notebookId: id })).length) await api.sources.importPdf({ notebookId: id })
  }, target.notebookId)
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await page.locator('.pdf-stage canvas').waitFor()
  await page.waitForFunction(() => document.querySelector('.pdf-stage canvas')?.width > 100)
  // The old Zoom in clamps fitted small pages to 210%; normalize both builds
  // below that ceiling so resize/zoom samples cover comparable canvas areas.
  const zoomPercent = () => page.locator('.zoom-label').evaluate((e) => parseInt(e.textContent, 10))
  for (let step = 0; (await zoomPercent()) > 190; step++) {
    if (step > 100) throw Error('Unable to normalize PDF zoom')
    const prior = await page.locator('.pdf-stage canvas').evaluate((e) => e.width)
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await page.waitForFunction((w) => document.querySelector('.pdf-stage canvas')?.width !== w, prior)
  }
  const pdfStartingZoomPercent = await zoomPercent()
  const interaction = []
  for (let run = 0; run < 5; run++) {
    const width = await page.locator('.pdf-stage canvas').evaluate((e) => e.width)
    let t = Date.now()
    await page.getByRole('button', { name: run % 2 === 0 ? 'Zoom out' : 'Zoom in', exact: true }).click()
    await page.waitForFunction((w) => document.querySelector('.pdf-stage canvas')?.width !== w, width)
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const pdfZoomMs = Date.now() - t
    t = Date.now()
    await app.evaluate(
      ({ BrowserWindow }, small) => BrowserWindow.getAllWindows()[0].setSize(small ? 1100 : 1440, 900),
      run % 2 === 0
    )
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const resizeMs = Date.now() - t
    await page.getByRole('button', { name: 'Record audio', exact: true }).first().click()
    await page.getByRole('button', { name: 'Stop recording', exact: true }).waitFor()
    const recordingFrameP95Ms = await frames()
    t = Date.now()
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click()
    await page.locator('.audio-block').nth(run).waitFor()
    const recordingSaveMs = Date.now() - t
    interaction.push({ pdfZoomMs, resizeMs, recordingFrameP95Ms, recordingSaveMs })
  }
  results.push({ scenario: 'pdf-recording', samples: interaction, medians: median(interaction) })
  const appBuild = createHash('sha256')
  for (const path of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html'])
    appBuild.update(await readFile(join(appRoot, path)))
  const report = {
    buildSha256: appBuild.digest('hex'),
    date: new Date().toISOString(),
    platform: process.platform,
    cpu: cpus()[0].model,
    revision: process.env.PERF_REVISION || 'working-tree',
    runs: 5,
    pdfStartingZoomPercent,
    results,
    limitations: [
      'Linux desktop with fake microphone; real device latency and Windows are unverified.',
      'Resize includes harness IPC-to-frame latency; explicit zoom remains fixed during resize. Interaction sampling starts at comparable zoom below 190%.',
      'IPC volume uses Electron internal invoke-handler instrumentation in this development harness.'
    ]
  }
  const output = process.env.PERF_OUTPUT || 'docs/performance-current.json'
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(output)
} finally {
  await app.close()
  if (!process.env.PERF_LIBRARY_ROOT) await rm(isolated, { recursive: true, force: true })
}
