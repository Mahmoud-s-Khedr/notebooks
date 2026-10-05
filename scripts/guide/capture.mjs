import { _electron } from 'playwright-core'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const demo = process.env.GUIDE_DEMO_ROOT || '/tmp/research-notebook-guide-demo'
const pdf = process.env.GUIDE_PDF || '/home/mk/Documents/think-python-2nd.pdf'
const output = join(root, 'docs/images/guide')
await mkdir(join(output, 'originals'), { recursive: true })
await mkdir(join(output, 'overlays'), { recursive: true })
await mkdir(join(demo, 'exports'), { recursive: true })
await mkdir(join(demo, 'fixtures'), { recursive: true })
await writeFile(join(demo, 'fixtures/research-notes.txt'), 'Demo exercise: compare reading, evidence, and reasoning.\n')
let app, page
let completed = false
const captures = process.env.GUIDE_RESUME
  ? JSON.parse(await readFile(join(output, 'capture-index.json'))).captures.filter(
      (c) => Number(c.id.slice(0, 2)) < (process.env.GUIDE_RESUME === 'tail' ? 33 : 10)
    )
  : []
const observations = []
async function launch() {
  app = await _electron.launch({
    executablePath: join(root, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', root],
    cwd: root,
    env: { ...process.env, XDG_CONFIG_HOME: join(demo, 'config') }
  })
  app.process().stderr.on('data', (chunk) => {
    if (/FATAL|ERROR|crash|signal/i.test(String(chunk))) console.error(String(chunk))
  })
  app.process().on('exit', (code, signal) => console.log('Electron exit', code, signal))
  page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  await page.waitForTimeout(1200)
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  if (!userData.startsWith(demo + '/')) throw Error('Library isolation failed: ' + userData)
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => globalThis.guidePicker ?? { canceled: true, filePaths: [] }
  })
  page.on('dialog', (d) => d.accept())
}
const b = (name) => page.getByRole('button', { name, exact: true })
const l = (name) => page.getByLabel(name, { exact: true })
async function settle() {
  await page.waitForTimeout(450)
}
async function picker(path) {
  await app.evaluate((_, path) => {
    globalThis.guidePicker = { canceled: false, filePaths: [path] }
  }, path)
}
async function menu(item) {
  await b('Application menu').click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
  await settle()
}
async function close() {
  await page.keyboard.press('Escape')
  await settle()
}
async function settings(section) {
  await menu('settings')
  await b(section).click()
  await settle()
}
async function snap(id, targets = [], focus = null) {
  await settle()
  let clip = focus ? await focus.boundingBox() : { x: 0, y: 0, ...page.viewportSize() }
  if (!clip || !clip.width) {
    clip = await page.evaluate(() => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }))
  }
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  clip = {
    x: Math.max(0, Math.floor(clip.x)),
    y: Math.max(0, Math.floor(clip.y)),
    width: Math.min(Math.ceil(clip.width), viewport.width - Math.max(0, Math.floor(clip.x))),
    height: Math.min(Math.ceil(clip.height), viewport.height - Math.max(0, Math.floor(clip.y)))
  }
  const boxes = []
  for (const [n, loc, description, shape = 'rect'] of targets) {
    const r = await loc.boundingBox()
    if (!r) throw Error('Missing target ' + id + ' ' + description)
    if (
      r.x + r.width <= clip.x ||
      r.y + r.height <= clip.y ||
      r.x >= clip.x + clip.width ||
      r.y >= clip.y + clip.height
    )
      throw Error('Target outside capture ' + id + ' ' + description)
    boxes.push({ n, description, shape, x: r.x - clip.x, y: r.y - clip.y, width: r.width, height: r.height })
  }
  const path = join(output, 'originals', id + '.png')
  await page.screenshot({ path, clip, timeout: 30000 })
  const body = boxes
    .map((r) => {
      let x = Math.max(3, r.x - 3),
        y = Math.max(3, r.y - 3),
        w = Math.min(clip.width - x - 3, r.width + 6),
        h = Math.min(clip.height - y - 3, r.height + 6)
      const cx = Math.min(clip.width - 14, x + w),
        cy = Math.max(14, y)
      const outline =
        r.shape === 'circle'
          ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/>`
          : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`
      return `<g fill="none" stroke="#ffffff" stroke-width="5">${outline}</g><g fill="none" stroke="#d42816" stroke-width="2.5">${outline}</g><circle cx="${cx}" cy="${cy}" r="12" fill="#b91c1c" stroke="white" stroke-width="2"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="white">${r.n}</text>`
    })
    .join('')
  const wrap = (inner) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${clip.width}" height="${clip.height}" viewBox="0 0 ${clip.width} ${clip.height}" role="img"><title>${id}: ${boxes
      .map((r) => r.n + ' ' + r.description)
      .join('; ')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')}</title>${inner}</svg>`
  await writeFile(join(output, 'overlays', id + '.svg'), wrap(body))
  await writeFile(
    join(output, id + '.svg'),
    wrap(
      `<image width="${clip.width}" height="${clip.height}" href="data:image/png;base64,${(await readFile(path)).toString('base64')}"/>` +
        body
    )
  )
  captures.push({ id, width: clip.width, height: clip.height, markers: boxes })
  console.log('Captured ' + id)
  await writeFile(
    join(output, 'capture-index.json'),
    JSON.stringify(
      {
        version: JSON.parse(await readFile(join(root, 'package.json'))).version,
        capturedAt: new Date().toISOString(),
        platform: process.platform,
        pdf: pdf.split('/').pop(),
        microphone: 'Chromium synthetic audio device; no real microphone permission prompt or speech tested',
        captures,
        observations
      },
      null,
      2
    )
  )
}
async function add(type, text) {
  if (type === 'text') await b('Add block').last().click()
  else {
    await b('Open block command menu').last().click()
    await page
      .locator('.slash-menu button')
      .filter({ hasText: '/' + type })
      .click()
  }
  await settle()
  const area = l(type + ' block').last()
  await area.fill(text)
  await b('Write').click()
  await settle()
}
async function action(type, name, index = 0) {
  await b('Actions for ' + type + ' block')
    .nth(index)
    .click()
  await page.getByRole('menuitem', { name, exact: true }).click()
  await settle()
}
try {
  await launch()
  if (process.env.GUIDE_RESUME === 'tail') {
    await b('Pagination exercise').click()
    await settle()
    await b('Load more notes').scrollIntoViewIfNeeded()
    await snap('33-pagination', [[1, b('Load more notes'), 'Load more notes']])
    await b('Load more notes').click()
    await settle()
  } else {
    if (process.env.GUIDE_RESUME) {
      await b('Practice captures').first().click()
      await b('Research').click()
      await page.waitForTimeout(1200)
    } else {
      if (await l('Notebook title').count())
        throw Error('Use a fresh GUIDE_DEMO_ROOT; captures require an empty library.')
      await snap('01-first-run', [
        [1, b('Create notebook'), 'Create notebook'],
        [2, b('New notebook'), 'New notebook'],
        [3, b('Application menu'), 'Application menu', 'circle']
      ])
      await b('Create notebook').click()
      await settle()
      await l('Notebook title').fill('Learning research')
      await b('Write').click()
      await settle()
      await l('Page title').fill('Reading and reasoning')
      await b('Write').click()
      await settle()
      await snap('02-hierarchy', [
        [1, l('Notebook title'), 'Rename notebook'],
        [2, l('Page title'), 'Rename page'],
        [3, l('New page for Learning research'), 'New page'],
        [4, b('Add note'), 'Add note'],
        [5, b('Page actions'), 'Page actions', 'circle'],
        [6, b('Move Learning research to trash'), 'Notebook trash', 'circle']
      ])
      await b('Add note').click()
      await settle()
      await add('text', 'Research aim: explain how examples improve understanding.')
      await add('source text', 'Evidence belongs beside its source reference.')
      await add('commentary', 'My interpretation: work through one small example before generalizing.')
      await add('explanation', 'Comparing two examples helps reveal what changes and what stays the same.')
      await add('question', 'How can a worked example help a first-time reader?')
      await add('answer', 'It gives the reader a concrete step to check.')
      await add('quote', 'Keep a clear distinction between evidence and interpretation.')
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1250))
      await l('text block').first().scrollIntoViewIfNeeded()
      await snap(
        '03-block-types',
        [
          [1, l('text block'), 'Text'],
          [2, l('source text block'), 'Source text'],
          [3, l('commentary block'), 'Commentary'],
          [4, l('explanation block'), 'Explanation'],
          [5, l('question block'), 'Question'],
          [6, l('answer block'), 'Answer'],
          [7, l('quote block'), 'Quote']
        ],
        page.locator('.note-document')
      )
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
      await b('Open block command menu').scrollIntoViewIfNeeded()
      await b('Open block command menu').click()
      await snap('04-insert-menu', [[1, page.locator('.slash-menu'), 'Insert a block']], page.locator('.slash-menu'))
      await close()
      await b('Actions for question block').click()
      await snap(
        '05-block-actions',
        [
          [1, page.getByRole('menuitem', { name: 'Duplicate', exact: true }), 'Duplicate'],
          [2, page.getByRole('menuitem', { name: 'Move up', exact: true }), 'Move up'],
          [3, page.getByRole('menuitem', { name: 'Move down', exact: true }), 'Move down'],
          [4, page.getByRole('menuitem', { name: 'Add answer', exact: true }), 'Add answer'],
          [5, page.getByRole('menuitem', { name: 'Inspector', exact: true }), 'Inspector'],
          [6, page.getByRole('menuitem', { name: 'Move to trash', exact: true }), 'Move to trash']
        ],
        page.locator('.menu-content')
      )
      await close()
      await action('question', 'Add answer')
      await l('answer block').last().fill('Check the example, then write the reasoning in your own words.')
      await b('Write').click()
      await settle()
      await action('text', 'Duplicate')
      await action('text', 'Move up', 1)
      await l('text block').last().focus()
      await page.keyboard.press('Alt+ArrowUp')
      await settle()
      // Exercise native HTML drag and drop between blocks.
      await b('Drag text block to reorder').last().dragTo(page.locator('.type-commentary'))
      await settle()
      await l('text block').first().scrollIntoViewIfNeeded()
      await snap('06-reorder', [
        [1, b('Drag text block to reorder').first(), 'Drag handle', 'circle'],
        [2, l('text block').first(), 'Focused text block for Alt+arrows']
      ])
      await action('answer', 'Inspector', 1)
      await snap(
        '07-inspector',
        [
          [1, page.getByLabel('Convert block'), 'Convert block'],
          [2, l('Relation type'), 'Relation type'],
          [3, l('Block to link'), 'Block to link'],
          [4, b('Link'), 'Link'],
          [5, page.locator('.relation').first(), 'Existing relation and remove control'],
          [6, page.locator('.metadata'), 'Read-only metadata'],
          [7, b('Close inspector'), 'Close inspector', 'circle']
        ],
        page.locator('.block-inspector')
      )
      await l('Relation type').selectOption('summarizes')
      await l('Block to link').selectOption({ index: 1 })
      await b('Link').click()
      await settle()
      await b('Remove relation').last().click()
      await b('Close inspector').click()
      await action('text', 'Inspector', 1)
      await page.getByLabel('Convert block').selectOption('commentary')
      await settle()
      await b('Close inspector').click()
      await action('text', 'Move to trash')
      await b('Application menu').click()
      await snap(
        '08-app-menu',
        [
          [1, page.getByRole('menuitem', { name: 'Import backup', exact: true }), 'Import lossless archive'],
          [2, page.getByRole('menuitem', { name: 'Back up library', exact: true }), 'Library backup'],
          [3, page.getByRole('menuitem', { name: 'jobs', exact: true }), 'jobs'],
          [4, page.getByRole('menuitem', { name: 'diagnostics', exact: true }), 'diagnostics'],
          [5, page.getByRole('menuitem', { name: 'settings', exact: true }), 'settings'],
          [6, page.getByRole('menuitem', { name: 'trash', exact: true }), 'trash']
        ],
        page.locator('.menu-content')
      )
      await close()
      await menu('trash')
      await snap(
        '09-trash',
        [
          [1, b('Restore').first(), 'Restore'],
          [2, b('Delete').first(), 'Permanent Delete']
        ],
        page.getByRole('dialog')
      )
      await b('Restore').first().click()
      await settle()
      await close()
      await l('New page for Learning research').fill('Practice captures')
      await l('New page for Learning research').press('Enter')
      await settle()
      await b('Add note').click()
      await settle()
      await add('text', 'Reading exercise: capture evidence, then explain it.')
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1100))
    await b('Research').click()
    await picker(pdf)
    await b('Import').click()
    await l('Selected PDF text').waitFor()
    await page.waitForTimeout(1600)
    await l('PDF page').fill('23')
    await l('PDF page').press('Tab')
    await page.waitForTimeout(1000)
    await b('Zoom in').click()
    for (let z = 0; z < 8; z++) await b('Zoom out').click()
    await page.waitForTimeout(900)
    await page.locator('.source-pane').evaluate((e) => {
      e.scrollTop = 0
      e.scrollLeft = 0
    })
    await l('Printed page').fill('1')
    await snap('10-research', [
      [1, b('Research'), 'Research mode'],
      [2, b('Import'), 'Import PDF'],
      [3, l('Source document'), 'Switch source'],
      [4, l('PDF page'), 'PDF page'],
      [5, b('Zoom in'), 'Zoom controls', 'circle'],
      [6, l('Printed page'), 'Printed page'],
      [7, l('Selected PDF text'), 'Editable extracted page text'],
      [8, b('Capture text'), 'Capture text'],
      [9, b('Create Q&A'), 'Create Q&A']
    ])
    await snap(
      '11-capture-controls',
      [
        [1, l('PDF page'), 'PDF page'],
        [2, b('Previous page'), 'Previous page', 'circle'],
        [3, b('Next page'), 'Next page', 'circle'],
        [4, b('Zoom out'), 'Zoom out', 'circle'],
        [5, b('Zoom in'), 'Zoom in', 'circle'],
        [6, l('Printed page'), 'Print p.'],
        [7, l('Selected PDF text'), 'Edit extracted text'],
        [8, b('Capture text'), 'Capture text'],
        [9, b('Create Q&A'), 'Create Q&A']
      ],
      page.locator('.capture-dock')
    )
    await l('Selected PDF text').fill('Chapter 1 introduces the way of the program.')
    await l('text block').click()
    await b('Capture text').click()
    await settle()
    await l('Selected PDF text').fill('What should I check when studying a worked example?')
    await b('Create Q&A').click()
    await settle()
    await snap('12-evidence', [
      [1, l('source text block'), 'Captured source text'],
      [2, page.locator('.provenance').first(), 'Source navigation'],
      [3, l('question block'), 'Q&A question'],
      [4, l('answer block'), 'Linked blank answer']
    ])
    await l('text block').click()
    await page.locator('.pdf-stage').evaluate((e) => (e.parentElement.scrollTop = 0))
    await settle()
    const stage = await page.locator('.pdf-stage').boundingBox()
    await page.mouse.move(stage.x + 20, stage.y + 45)
    await page.mouse.down()
    await page.mouse.move(stage.x + 210, stage.y + 110, { steps: 12 })
    await page.mouse.up()
    await settle()
    await snap('13-region', [
      [1, page.locator('.pdf-stage'), 'Drag down and right on the PDF'],
      [2, page.locator('.asset-image'), 'Captured region image']
    ])
    await b('Next page').click()
    await page.waitForTimeout(800)
    await page.locator('.provenance').first().click()
    await page.waitForTimeout(800)
    if ((await l('PDF page').inputValue()) !== '23') throw Error('Source navigation failed in Research mode')
    await b('Collapse notebook sidebar').click()
    await snap('14-layout', [
      [1, b('Expand notebook sidebar'), 'Expand sidebar', 'circle'],
      [2, page.getByRole('separator'), 'Drag divider to resize panes'],
      [3, b('Write'), 'Write mode']
    ])
    const divider = await page.getByRole('separator').boundingBox()
    await page.mouse.move(divider.x + divider.width / 2, divider.y + 250)
    await page.mouse.down()
    await page.mouse.move(divider.x + 50, divider.y + 250)
    await page.mouse.up()
    await b('Expand notebook sidebar').click()
    await b('Attach media').click()
    await snap(
      '15-attachments',
      [
        [1, page.getByRole('menuitem', { name: 'Attach image', exact: true }), 'Attach image'],
        [2, page.getByRole('menuitem', { name: 'Attach screenshot', exact: true }), 'Attach screenshot'],
        [3, page.getByRole('menuitem', { name: 'Attach audio', exact: true }), 'Attach audio'],
        [4, page.getByRole('menuitem', { name: 'Attach file', exact: true }), 'Attach file']
      ],
      page.locator('.menu-content')
    )
    await close()
    for (const kind of ['image', 'screenshot', 'file']) {
      await l('text block').click()
      await picker(
        kind === 'file' ? join(demo, 'fixtures/research-notes.txt') : join(output, 'originals/01-first-run.png')
      )
      await b('Attach media').click()
      await page.getByRole('menuitem', { name: 'Attach ' + kind, exact: true }).click()
      await settle()
    }
    await b('Write').click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
    await b('Add note').click()
    await settle()
    await b('Record audio').last().scrollIntoViewIfNeeded()
    await snap(
      '16-record-ready',
      [
        [1, b('Record audio').last(), 'Record audio'],
        [2, b('Add block').last(), 'Add block']
      ],
      page.locator('.note-document').last()
    )
    await b('Record audio').last().click()
    await b('Stop recording').waitFor()
    await page.waitForTimeout(1500)
    await snap(
      '17-recording',
      [
        [1, b('Stop recording'), 'Stop recording'],
        [2, page.locator('.recording-indicator'), 'Recording status and input meter']
      ],
      page.locator('.note-document').last()
    )
    await b('Stop recording').click()
    await settle()
    await snap(
      '18-audio',
      [
        [1, page.locator('audio').last(), 'Playback controls'],
        [2, l('Transcription provider').last(), 'Provider'],
        [3, l('Language hint').last(), 'Language hint'],
        [4, b('Transcribe').last(), 'Transcribe']
      ],
      page.locator('.note-document').last()
    )
    await l('Language hint').last().selectOption('en')
    await b('Transcribe').last().click()
    await page.waitForTimeout(1400)
    await b('Transcribe').last().scrollIntoViewIfNeeded()
    await snap(
      '19-transcription-unavailable',
      [[1, page.getByRole('alert'), 'Missing runtime alert']],
      page.getByRole('alert')
    )
    observations.push(
      'Local transcription attempted; runtime is absent in this source build. No transcript success claimed.'
    )
    await settings('General')
    await page.getByLabel('Appearance').selectOption('dark')
    await settle()
    await snap(
      '20-appearance',
      [
        [1, page.getByLabel('Appearance'), 'Appearance'],
        [2, page.getByLabel('Layout density'), 'Layout density'],
        [3, b('Back to workspace'), 'Back to workspace']
      ],
      page.locator('.settings-page')
    )
    await page.getByLabel('Appearance').selectOption('light')
    await page.getByLabel('Layout density').selectOption('compact')
    await settle()
    await page.getByLabel('Layout density').selectOption('default')
    await b('Transcription').click()
    await snap(
      '21-models',
      [
        [1, page.getByPlaceholder('Enter API key'), 'Local API key field'],
        [2, b('Save key'), 'Save key'],
        [3, page.locator('.model-card').first(), 'Tiny model and Download'],
        [4, page.locator('.model-card').nth(1), 'Base model and Download']
      ],
      page.locator('.settings-content')
    )
    await page.locator('.model-card').first().getByRole('button', { name: 'Download', exact: true }).click()
    await page.waitForTimeout(1200)
    await snap(
      '22-model-download',
      [[1, page.locator('.model-card').first(), 'Actual download state']],
      page.locator('.settings-content')
    )
    const cancel = page.locator('.model-card').first().getByRole('button', { name: 'Cancel', exact: true })
    if (await cancel.count()) await cancel.click()
    await page.waitForTimeout(1400)
    await b('Maintenance').click()
    await b('Scan active notebook assets').click()
    await snap(
      '23-maintenance',
      [
        [1, b('Back up library'), 'Back up library'],
        [2, b('Scan active notebook assets'), 'Asset scan'],
        [3, b('Export diagnostics'), 'Export diagnostics'],
        [4, page.locator('.diagnostic-result'), 'Scan counts'],
        [5, page.locator('.settings-jobs'), 'Actual job history']
      ],
      page.locator('.settings-page')
    )
    await b('Back to workspace').click()
    await l('Transcription provider').last().selectOption('openrouter')
    await b('Transcribe').last().click()
    await page.waitForTimeout(900)
    await snap(
      '24-cloud-unavailable',
      [
        [1, l('Transcription provider').last(), 'OpenRouter selected'],
        [2, page.locator('.transcription').last(), 'Actual status without credentials']
      ],
      page.locator('.note-document').last()
    )
    observations.push('OpenRouter attempted without a key; no external audio request or charges authorized.')
    await menu('jobs')
    await snap(
      '25-jobs',
      [[1, page.locator('.jobs-list'), 'Actual statuses and Retry controls']],
      page.getByRole('dialog')
    )
    const retry = b('Retry')
    if (await retry.count()) {
      await retry.first().click()
      await page.waitForTimeout(1200)
    }
    await close()
    await menu('diagnostics')
    await b('Scan assets').click()
    await page.locator('details summary').first().click()
    await b('Show full detail').first().click()
    await snap(
      '26-diagnostics',
      [
        [1, l('Filter errors by process'), 'Process filter'],
        [2, l('Filter errors by severity'), 'Severity filter'],
        [3, l('Filter errors by category'), 'Category filter'],
        [4, b('Export diagnostics'), 'Export diagnostics'],
        [5, b('Show full detail').first(), 'Show full detail']
      ],
      page.getByRole('dialog')
    )
    await picker(join(demo, 'exports'))
    await b('Export diagnostics').click()
    await l('Filter errors by process').selectOption('main')
    await l('Filter errors by severity').selectOption('error')
    await l('Filter errors by category').fill('transcription')
    await close()
    await b('Page actions').click()
    await snap(
      '27-page-actions',
      [
        [1, page.getByRole('menuitem', { name: 'Export page', exact: true }), 'Export page'],
        [2, page.getByRole('menuitem', { name: 'Move page to trash', exact: true }), 'Move page to trash']
      ],
      page.locator('.menu-content')
    )
    await close()
    await b('Record audio').last().focus()
    await b('Page actions').click()
    await page.getByRole('menuitem', { name: 'Export page', exact: true }).click()
    await snap(
      '28-export',
      [
        [1, page.getByLabel('Scope'), 'Scope'],
        [2, b('markdown'), 'markdown'],
        [3, b('pdf'), 'pdf'],
        [4, b('lossless json'), 'lossless json'],
        [5, b('ai context'), 'ai context']
      ],
      page.getByRole('dialog')
    )
    await close()
    for (const [format, scope] of [
      ['markdown', 'notebook'],
      ['pdf', 'page'],
      ['lossless json', 'notebook'],
      ['ai context', 'note']
    ]) {
      await b('Record audio').last().focus()
      await b('Page actions').click()
      await page.getByRole('menuitem', { name: 'Export page', exact: true }).click()
      await page.getByLabel('Scope').selectOption(scope)
      await picker(join(demo, 'exports'))
      await b(format).click()
      await settle()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      observations.push('Export completed: ' + format + ' / ' + scope)
    }
    // Exercise keyboard note creation and imported audio with a saved synthetic WAV.
    const beforeNotes = await page.locator('.note-document').count()
    await page.keyboard.press('Control+Shift+N')
    await settle()
    if ((await page.locator('.note-document').count()) !== beforeNotes + 1) throw Error('New-note shortcut failed')
    const wavNames = await readdir(join(demo, 'config/research-notebook/assets/audio'))
    const wav = wavNames.find((n) => n.endsWith('.wav'))
    if (!wav) throw Error('Recorded WAV missing')
    await b('Research').click()
    await b('Record audio').last().focus()
    await picker(join(demo, 'config/research-notebook/assets/audio', wav))
    await b('Attach media').click()
    await page.getByRole('menuitem', { name: 'Attach audio', exact: true }).click()
    await settle()
    await b('Write').click()
    observations.push('Imported saved synthetic WAV using Attach audio; Ctrl+Shift+N created a note.')
    await picker(join(demo, 'exports'))
    await menu('Back up library')
    await page.waitForTimeout(1400)
    await menu('jobs')
    await snap(
      '29-backup-complete',
      [[1, page.locator('.job-row').filter({ hasText: 'backup' }), 'Actual backup job status']],
      page.getByRole('dialog')
    )
    await close()
    const dirs = await readdir(join(demo, 'exports'))
    let archive
    for (const dir of dirs) {
      try {
        await readFile(join(demo, 'exports', dir, 'notebook.lossless.v1.json'))
        archive = join(demo, 'exports', dir, 'notebook.lossless.v1.json')
      } catch {
        /* Cleanup is best effort. */
      }
    }
    if (!archive) throw Error('Lossless export absent')
    await picker(archive)
    await menu('Import backup')
    await page.reload()
    await settle()
    observations.push('Lossless import completed; reload required to refresh sidebar.')
    await snap('30-imported', [[1, page.locator('.notebook-tree').last(), 'Imported notebook copy']])
    await b('Practice captures').first().click()
    await b('Page actions').click()
    await page.getByRole('menuitem', { name: 'Move page to trash', exact: true }).click()
    await settle()
    await menu('trash')
    await snap(
      '31-page-trash',
      [
        [1, page.locator('.trash-list'), 'Page and descendants'],
        [2, b('Restore').first(), 'Restore'],
        [3, b('Delete').first(), 'Permanent delete']
      ],
      page.getByRole('dialog')
    )
    await close()
    // A disposable page checks immediate permanent deletion without risking the example notebook.
    await l('New page for Learning research').first().fill('Disposable page')
    await l('New page for Learning research').first().press('Enter')
    await settle()
    await b('Page actions').click()
    await page.getByRole('menuitem', { name: 'Move page to trash', exact: true }).click()
    await settle()
    await menu('trash')
    await page
      .locator('.trash-row')
      .filter({ hasText: 'Disposable page' })
      .getByRole('button', { name: 'Delete', exact: true })
      .click()
    await settle()
    await page
      .locator('.trash-row')
      .filter({ hasText: 'Practice captures' })
      .filter({ has: page.locator('small').filter({ hasText: 'page ·' }) })
      .getByRole('button', { name: 'Restore', exact: true })
      .click()
    await close()
    await b('Move Learning research to trash').first().click()
    await settle()
    await menu('trash')
    await page
      .locator('.trash-row')
      .filter({ hasText: 'Learning research' })
      .first()
      .getByRole('button', { name: 'Restore', exact: true })
      .click()
    await settle()
    await close()
    observations.push('Notebook cascade move-to-trash and restoration exercised.')
    await b('Reading and reasoning').first().click()
    await page.keyboard.press('Control+k')
    await page.getByPlaceholder('Search notes, sources, or ask…').fill('worked')
    await settle()
    await snap(
      '32-search',
      [
        [1, page.getByPlaceholder('Search notes, sources, or ask…'), 'Search terms'],
        [2, page.locator('.search-results'), 'Local matches']
      ],
      page.getByRole('dialog')
    )
    await page.locator('.search-results button').first().click()
    await settle()
    // Fixture setup only: note pagination has no practical 51-note manual capture loop.
    await page.evaluate(async () => {
      const api = window.researchNotebook
      const tree = await api.notebooks.list()
      const nb = tree[0]
      const p = await api.pages.create({ notebookId: nb.id, title: 'Pagination exercise' })
      for (let i = 0; i < 51; i++) await api.notes.create({ pageId: p.id, title: 'Demo note ' + (i + 1) })
    })
    await page.reload()
    await settle()
    await b('Pagination exercise').click()
    await settle()
    await b('Load more notes').scrollIntoViewIfNeeded()
    await snap('33-pagination', [[1, b('Load more notes'), 'Load more notes']])
    await b('Load more notes').click()
    await settle()
    if ((await page.locator('.note-document').count()) !== 51) throw Error('Pagination count mismatch')
    observations.push('Load more notes exercised with 51 bridge-seeded demo notes; 50 then 51 displayed.')
  }
  await b('Reading and reasoning').first().click()
  await settings('Library & Storage')
  await snap(
    '34-storage',
    [
      [1, page.locator('.settings-card').first(), 'Active library and sizes'],
      [2, b('Move library…'), 'Move library…']
    ],
    page.locator('.settings-page')
  )
  await mkdir(join(demo, 'relocated'), { recursive: true })
  await picker(join(demo, 'relocated'))
  await b('Move library…').click()
  await page.getByText('Move verified. Restart the application to activate the new library.').waitFor()
  await snap(
    '35-restart-required',
    [[1, page.locator('.diagnostic-result'), 'Restart required']],
    page.locator('.settings-page')
  )
  await app.close()
  await launch()
  await settings('Library & Storage')
  await snap(
    '36-remove-original',
    [
      [1, page.locator('.settings-card').first(), 'New active library'],
      [2, page.locator('.old-library'), 'Retained original'],
      [3, b('Remove original'), 'Remove original']
    ],
    page.locator('.settings-page')
  )
  await b('Remove original').click()
  await page.waitForTimeout(1400)
  observations.push(
    'Library move, application restart, new library activation and original removal exercised in isolated demo only.'
  )
  await snap(
    '37-storage-after-removal',
    [[1, page.locator('.settings-card').first(), 'Active relocated library']],
    page.locator('.settings-page')
  )
  completed = true
  console.log('Capture complete')
} finally {
  if (app) await app.close().catch(() => {})
  await writeFile(
    join(output, 'capture-index.json'),
    JSON.stringify(
      {
        complete: completed,
        version: '0.1.0',
        capturedAt: new Date().toISOString(),
        platform: process.platform,
        pdf: pdf.split('/').pop(),
        microphone: 'Chromium synthetic audio device; no real microphone permission prompt or speech tested',
        captures,
        observations
      },
      null,
      2
    )
  )
}
