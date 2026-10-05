import { _electron } from 'playwright-core'
import { mkdtemp, mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '../..')
const guide = join(root, 'docs/images/guide')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const version = '2026-10-05-reliability'
const buildHash = createHash('sha256')
for (const path of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html'])
  buildHash.update(await readFile(join(root, path)))
const buildSha256 = buildHash.digest('hex')
const output = join(guide, 'captures', version)
await mkdir(join(output, 'originals'), { recursive: true })
const archive = join(guide, 'captures', '2026-10-05-before-fixes')
await mkdir(archive, { recursive: true })
await cp(join(guide, 'originals'), join(archive, 'originals'), { recursive: true, force: false, errorOnExist: false })
await cp(join(guide, 'capture-index.json'), join(archive, 'capture-index.json'), {
  force: false,
  errorOnExist: false
}).catch(() => undefined)
const index = JSON.parse(await readFile(join(guide, 'capture-index.json'), 'utf8'))
const demo = await mkdtemp(join(tmpdir(), 'notebook-workflow-'))
const observations = []
let app, page
async function launch() {
  app = await _electron.launch({
    executablePath: join(root, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', root],
    cwd: root,
    env: { ...process.env, XDG_CONFIG_HOME: demo }
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  if (!userData.startsWith(demo + '/')) throw Error('Isolation failed')
  await page.waitForFunction(() => Boolean(window.researchNotebook))
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => globalThis.testPicker ?? { canceled: true, filePaths: [] }
  })
}
const b = (name) => page.getByRole('button', { name, exact: true })
const l = (name) => page.getByLabel(name, { exact: true })
const pick = (path) =>
  app.evaluate((_, path) => {
    globalThis.testPicker = { canceled: false, filePaths: [path] }
  }, path)
const check = (condition, message) => {
  if (!condition) throw Error(message)
  observations.push(message)
}
async function snap(id, targets = []) {
  await page.waitForTimeout(150)
  for (const [locator] of targets) await locator.first().scrollIntoViewIfNeeded()
  const markers = []
  for (let i = 0; i < targets.length; i++) {
    const [locator, description] = targets[i]
    const box = await locator.first().boundingBox()
    if (!box) throw Error('Missing capture control ' + description)
    markers.push({ ...box, n: i + 1, description })
  }
  await page.screenshot({ path: join(output, 'originals', id + '.png') })
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const capture = { id, ...size, markers, originalPath: `captures/${version}/originals/${id}.png` }
  const focused = new Set([
    '04-insert-menu',
    '08-app-menu',
    '11-capture-controls',
    '15-attachments',
    '24-cloud-unavailable',
    '16-record-ready',
    '17-recording',
    '18-audio',
    '19-transcription-unavailable',
    '32-search',
    '34-storage',
    '35-restart-required',
    '36-remove-original',
    '38-source-switch',
    '44-text-region',
    '46-save-retry',
    '47-trash-confirmation',
    '48-media-preview',
    '49-external-disclosure'
  ])
  if (focused.has(id) && markers.length) {
    const x = Math.max(0, Math.min(...markers.map((r) => r.x)) - 20)
    const y = Math.max(0, Math.min(...markers.map((r) => r.y)) - 20)
    const right = Math.min(size.width, Math.max(...markers.map((r) => r.x + r.width)) + 20)
    const bottom = Math.min(size.height, Math.max(...markers.map((r) => r.y + r.height)) + 20)
    capture.displayCrop = { x, y, width: right - x, height: bottom - y }
  }

  const prior = index.captures.findIndex((c) => c.id === id)
  if (prior < 0) index.captures.push(capture)
  else index.captures[prior] = capture
}
async function menu(name) {
  await b('Application menu').click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
try {
  await launch()
  await snap('01-first-run', [
    [b('Create notebook'), 'Create notebook'],
    [b('New notebook'), 'New notebook'],
    [b('Application menu'), 'Application menu']
  ])
  await b('Create notebook').click()
  await l('Page title').fill('Evidence workshop')
  await l('Page title').press('Tab')
  await b('Add note').click()
  await l('Note title').fill('Receiving note')
  await l('Note title').press('Tab')
  await b('Add block').click()
  await l('text block').fill('Evidence stays saved when navigation changes.')
  await snap('02-hierarchy', [
    [l('Notebook title'), 'Notebook title'],
    [l('Page title'), 'Page title'],
    [l('New page for Untitled notebook'), 'New page'],
    [b('Add note'), 'Add note'],
    [b('Page actions'), 'Page actions'],
    [page.getByRole('button', { name: 'Move Untitled notebook to trash' }), 'Notebook trash']
  ])
  await snap('43-note-actions', [
    [l('Note title'), 'Edit note title'],
    [b('Move note to trash'), 'Move note to trash'],
    [l('Filter notebook and page titles'), 'Filter notebook and page titles']
  ])
  await l('text block').fill('')
  await l('text block').press('/')
  await page.getByRole('button', { name: '/explanation explanation block' }).waitFor()
  await snap('04-insert-menu', [[page.locator('.slash-menu'), 'Keyboard block menu']])
  await page.keyboard.press('Escape')
  await b('Application menu').click()
  await snap('08-app-menu', [
    [page.getByRole('menuitem', { name: 'Import lossless archive…' }), 'Import lossless archive'],
    [page.getByRole('menuitem', { name: 'Back up library' }), 'Whole-library backup']
  ])
  await page.keyboard.press('Escape')
  await b('Research').click()
  await pick(join(root, 'src/renderer/src/test/fixtures/source.pdf'))
  await b('Import').click()
  await page.locator('.textLayer span').first().waitFor()
  const selectable = await page
    .locator('.textLayer span')
    .evaluateAll((spans) => spans.map((e) => e.textContent).join(' '))
  check(selectable.length > 0, 'PDF.js selectable text layer rendered in Electron')
  const span = page.locator('.textLayer span').first()
  const box = await span.boundingBox()
  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 15 })
  await page.mouse.up()
  check((await page.evaluate(() => getSelection().toString())).length > 0, 'Real mouse drag selected PDF text')
  await l('Selected PDF text').fill('Edited extracted evidence')
  await b('Zoom in').click()
  await page.waitForTimeout(300)
  check(
    (await l('Selected PDF text').inputValue()) === 'Edited extracted evidence',
    'PDF zoom preserves edited extracted text'
  )
  await l('PDF page').fill('999')
  await l('PDF page').press('Enter')
  check((await l('PDF page').inputValue()) === '1', 'Invalid PDF page is clamped to document bounds')
  await l('Printed page').fill('17')
  await snap('10-research', [
    [b('Research'), 'Research mode'],
    [b('Import'), 'Import PDF'],
    [l('Source document'), 'Source document'],
    [l('PDF page'), 'Physical PDF page'],
    [b('Zoom in'), 'Zoom'],
    [l('Printed page'), 'Printed page'],
    [l('Selected PDF text'), 'Editable extracted text'],
    [b('Capture text'), 'Capture text'],
    [b('Create Q&A'), 'Create Q&A']
  ])
  await snap('44-text-region', [
    [b('Text'), 'Text mode is the default'],
    [b('Region'), 'Region capture mode'],
    [page.getByText('Capture to: Receiving note'), 'Explicit receiving note']
  ])
  await snap('11-capture-controls', [
    [l('PDF page'), 'Physical page'],
    [b('Previous page'), 'Previous page'],
    [b('Next page'), 'Next page'],
    [b('Zoom out'), 'Zoom out'],
    [b('Zoom in'), 'Zoom in'],
    [l('Printed page'), 'Printed page'],
    [l('Selected PDF text'), 'Editable extracted text'],
    [b('Capture text'), 'Capture text'],
    [b('Create Q&A'), 'Create Q&A']
  ])
  await b('Capture text').click()
  await page.getByLabel('source text block', { exact: true }).waitFor()
  await b('Write').click()
  await page.locator('.provenance').first().click()
  await page.locator('.textLayer span').first().waitFor()
  check(
    (await l('Printed page').inputValue()) === '17',
    'Source link from Write restores Research mode and printed-page provenance'
  )
  const originalSource = await l('Source document').inputValue()
  const comparison = join(demo, 'comparison.pdf')
  await cp(join(root, 'src/renderer/src/test/fixtures/source.pdf'), comparison)
  await pick(comparison)
  await b('Import').click()
  await l('Source document').selectOption({ label: 'comparison.pdf' })
  await page.waitForTimeout(200)
  check((await l('Printed page').inputValue()) === '', 'Switching sources clears printed-page draft provenance')
  await snap('38-source-switch', [
    [l('Source document'), 'Selected comparison source'],
    [page.locator('.source-header h2'), 'Selected source title']
  ])
  await page.locator('.provenance').first().click()
  await page.waitForFunction(
    (id) => document.querySelector('select[aria-label="Source document"]')?.value === id,
    originalSource
  )
  check(
    (await l('Printed page').inputValue()) === '17',
    'Cross-document source link restores the original source and printed page'
  )
  await b('Region').click()
  const regionText = await page.locator('.textLayer span').first().boundingBox()
  await page.mouse.move(regionText.x - 5, regionText.y - 5)
  await page.mouse.down()
  await page.mouse.move(regionText.x + regionText.width + 5, regionText.y + regionText.height + 10, { steps: 10 })
  await page.mouse.up()
  await page.locator('.asset-image').first().waitFor()
  await snap('13-region', [
    [page.locator('.pdf-stage'), 'Region drag area'],
    [page.locator('.asset-image'), 'Captured region preview']
  ])
  await snap('48-media-preview', [
    [page.locator('.asset-image'), 'Viewport-loaded cached preview'],
    [b('Load original image'), 'Load full original only when requested']
  ])
  await b('Attach media').click()
  await snap(
    '15-attachments',
    [
      ['image', 'screenshot', 'audio', 'file'].map((kind) => [
        page.getByRole('menuitem', { name: `Attach ${kind}`, exact: true }),
        `Attach ${kind}`
      ])
    ].flat()
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Collapse notebook sidebar', exact: true }).click()
  await snap('14-layout', [
    [b('Expand notebook sidebar'), 'Expand sidebar'],
    [page.locator('.pane-resize'), 'Resize source and editor panes'],
    [b('Write'), 'Write mode']
  ])
  await b('Expand notebook sidebar').click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640))
  await page.waitForTimeout(300)
  const dock = await page.locator('.capture-dock').boundingBox()
  check(
    dock.y + dock.height <= (await page.evaluate(() => innerHeight)),
    'PDF capture controls remain visible at 960 × 640'
  )
  await snap('45-minimum-window', [
    [b('Text'), 'Text mode'],
    [l('PDF page'), 'Page controls'],
    [b('Capture text'), 'Capture controls']
  ])
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await b('Write').click()
  await l('Note title').click()
  await snap('16-record-ready', [
    [b('Record audio').last(), 'Start recording in this note'],
    [b('Add block'), 'Add block']
  ])
  await b('Open block command menu').click()
  await page.getByRole('button', { name: '/audio Use Record audio' }).click()
  await b('Stop recording').waitFor()
  await snap('17-recording', [
    [b('Stop recording'), 'Stop and save'],
    [page.locator('.recording-indicator'), 'Recording status and input level']
  ])
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('assets:save-recording')
    globalThis.failSave = true
    ipcMain._invokeHandlers.set('assets:save-recording', (...args) => {
      if (globalThis.failSave) {
        globalThis.failSave = false
        throw Error('Controlled recording save failure')
      }
      return original(...args)
    })
  })
  await b('Research').click()
  await b('Retry save').waitFor()
  check((await b('Write').getAttribute('aria-pressed')) === 'true', 'Failed recording save cancels mode navigation')
  await snap('46-save-retry', [
    [b('Retry save'), 'Retry the retained WAV'],
    [page.getByRole('alert'), 'Save failure explanation']
  ])
  await b('Retry save').click()
  await page.locator('.audio-block').waitFor()
  await snap('18-audio', [
    [page.locator('audio'), 'Saved WAV player'],
    [l('Transcription provider'), 'Transcription provider'],
    [b('Transcribe'), 'Transcribe when prerequisites are ready']
  ])
  check(
    await b('Transcribe').isDisabled(),
    'Unavailable local runtime disables execution before a paid or local request'
  )
  await snap('19-transcription-unavailable', [
    [page.getByText(/Whisper runtime is missing/), 'Runtime prerequisite explanation'],
    [b('Transcribe'), 'Disabled until ready']
  ])
  await menu('trash')
  await b('Close Trash').click()
  await b('Move note to trash').click()
  await page.getByText('This topic has no notes yet.').waitFor()
  await menu('trash')
  await b('Delete').click()
  check(await b('Cancel').evaluate((e) => e === document.activeElement), 'Permanent deletion defaults focus to Cancel')
  await snap('47-trash-confirmation', [
    [b('Cancel'), 'Cancel is the default'],
    [b('Permanently delete'), 'Irreversible deletion'],
    [page.getByText(/Delete “Receiving note”/), 'Item and descendant warning']
  ])
  await b('Cancel').click()
  await b('Restore').click()
  await b('Close Trash').click()
  await l('Note title').waitFor()
  await b('Application menu').click()
  await page.getByRole('menuitem', { name: 'settings', exact: true }).click()
  await b('Library & Storage').click()
  await b('Refresh storage').waitFor()
  await snap('34-storage', [
    [page.locator('.settings-card code').first(), 'Active library'],
    [page.locator('.storage-grid'), 'B, KB, MB and GB sizes'],
    [b('Move library…'), 'Move library'],
    [b('Refresh storage'), 'Refresh storage scan']
  ])
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click()
  await page.getByRole('button', { name: /Search pages/ }).click()
  await page.getByPlaceholder('Search pages, notes, and blocks…').fill('no-match-unique')
  await page.getByText('No matches.').waitFor()
  await snap('32-search', [
    [page.getByPlaceholder('Search pages, notes, and blocks…'), 'Search stored titles and block text'],
    [page.getByText('No matches.'), 'Distinct no-match state']
  ])
  await page.keyboard.press('Escape')
  // Lossless import refresh, using a real archive produced by the app.
  await pick(join(demo, 'exports'))
  await page
    .evaluate(async () => {
      const api = window.researchNotebook
      const tree = await api.notebooks.list()
      const job = await api.exports.start({
        scope: { type: 'notebook', notebookId: tree[0].id },
        format: 'lossless-json'
      })
      for (let i = 0; i < 100; i++) {
        const next = (await api.jobs.list()).find((j) => j.id === job.id)
        if (next.status === 'completed') return next.result
        await new Promise((r) => setTimeout(r, 50))
      }
      throw Error('Export timed out')
    })
    .then(async (result) => {
      await pick(join(result.directory, 'notebook.lossless.v1.json'))
    })
  await menu('Import lossless archive…')
  await page.waitForTimeout(300)
  check(
    (await l('Page title').inputValue()) === 'Evidence workshop',
    'Lossless import immediately opens its first page'
  )
  await snap('30-imported', [
    [l('Page title'), 'Imported page opens immediately'],
    [l('Note title'), 'Imported note title']
  ])
  await l('Transcription provider').first().selectOption('openrouter')
  await page.getByText('Configure an OpenRouter key in Settings.').first().waitFor()
  await snap('24-cloud-unavailable', [
    [l('Transcription provider'), 'OpenRouter provider'],
    [page.getByText('Configure an OpenRouter key in Settings.'), 'Missing-key explanation']
  ])
  await l('Transcription provider').first().selectOption('local')
  await page.evaluate(() =>
    window.researchNotebook.settings.setOpenRouterKey({ key: 'guide-demo-dummy-key-do-not-use' })
  )
  await l('Transcription provider').first().selectOption('openrouter')
  await page
    .getByText('Audio is sent to OpenRouter and its transcription provider. External service charges may apply.')
    .first()
    .waitFor()
  await snap('49-external-disclosure', [
    [l('Transcription provider'), 'External provider choice'],
    [
      page.getByText('Audio is sent to OpenRouter and its transcription provider. External service charges may apply.'),
      'Explicit transfer and charges disclosure'
    ]
  ])
  await page.evaluate(() => window.researchNotebook.settings.removeOpenRouterKey())
  await l('Transcription provider').first().selectOption('local')
  // Failed window closure preserves audio; a retry and subsequent close persist exactly two new recordings.
  const currentPage = await page.locator('.page-header').getAttribute('data-item-id')
  const countAudio = () =>
    page.evaluate(
      async (id) =>
        (await window.researchNotebook.pages.getWorkspace({ pageId: id })).notes
          .flatMap((n) => n.blocks)
          .filter((b) => b.type === 'audio').length,
      currentPage
    )
  const beforeAudio = await countAudio()
  await b('Record audio').first().click()
  await b('Stop recording').waitFor()
  await page.waitForTimeout(350)
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.failSave = true
    BrowserWindow.getAllWindows()[0].close()
  })
  await b('Retry save').waitFor()
  check(!page.isClosed(), 'Failed recording save cancels window closure and retains Retry save')
  await b('Retry save').click()
  await page.waitForFunction(
    async ({ id, count }) =>
      (await window.researchNotebook.pages.getWorkspace({ pageId: id })).notes
        .flatMap((n) => n.blocks)
        .filter((b) => b.type === 'audio').length === count,
    { id: currentPage, count: beforeAudio + 1 }
  )
  await b('Record audio').first().click()
  await b('Stop recording').waitFor()
  await page.waitForTimeout(350)
  const closed = page.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  await app.close().catch(() => undefined)
  await launch()
  check(
    (await countAudio()) === beforeAudio + 2,
    'Window close saves exactly one additional recording and both recovered clips survive relaunch'
  )
  await b('Evidence workshop').first().click()
  await page.locator('audio').first().waitFor()
  await menu('settings')
  await b('Library & Storage').click()
  await pick(join(demo, 'moved'))
  await b('Move library…').click()
  await page.getByText(/Library move verified/).waitFor()
  const blocked = await page.evaluate(async () => {
    try {
      await window.researchNotebook.notebooks.create({ title: 'Late write' })
      return false
    } catch {
      return true
    }
  })
  check(blocked, 'Main/service write barrier rejects late writes while awaiting restart')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640))
  await snap('35-restart-required', [
    [b('Restart now'), 'Restart now activates the verified destination'],
    [page.getByText(/Library move verified/), 'Persistent editing restriction']
  ])
  const prior = await page.evaluate(async () => (await window.researchNotebook.settings.storage()).libraryPath)
  await app.evaluate(({ app }) => {
    app.relaunch = () => {
      globalThis.relaunchRequested = true
    }
  })
  await b('Restart now').click()
  await page.waitForEvent('close').catch(() => undefined)
  await app.close().catch(() => undefined)
  await launch()
  const storage = await page.evaluate(() => window.researchNotebook.settings.storage())
  check(
    storage.libraryPath !== prior && storage.oldLibraryPath === prior,
    'Restart bootstrap activates the destination and retains the original'
  )
  await menu('settings')
  await b('Library & Storage').click()
  await b('Remove original').waitFor()
  await snap('36-remove-original', [
    [b('Remove original'), 'Original removal is available after destination activation']
  ])
  page.once('dialog', (d) => d.accept())
  await b('Remove original').click()
  await page.waitForFunction(async () => !(await window.researchNotebook.settings.storage()).oldLibraryPath)
  check(
    (await page.evaluate(() => window.researchNotebook.notebooks.list())).length === 2,
    'Original removal preserves the active imported and original notebooks'
  )
  index.complete = true
  index.updatedAt = new Date().toISOString()
  index.reliabilityBuild = {
    version: '0.1.0',
    buildSha256,
    revision,
    workingTree: true,
    captureDate: '2026-10-05',
    platform: 'linux'
  }
  await writeFile(join(guide, 'capture-index.json'), JSON.stringify(index, null, 2) + '\n')
  await writeFile(
    join(root, 'docs/workflow-verification.json'),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        revision,
        buildSha256,
        workingTree: true,
        platform: 'linux',
        isolatedLibrary: demo,
        observations,
        limitations: [
          'Synthetic microphone only.',
          'Restart relaunch was intercepted to keep the harness in control; a fresh Electron process exercised the real bootstrap destination.',
          'No cloud request or real Whisper execution.'
        ]
      },
      null,
      2
    ) + '\n'
  )
  console.log('Verified', observations.length, 'workflows; demo library:', demo)
} finally {
  await app?.close().catch(() => undefined)
}
