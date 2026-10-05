// Supplemental real-app source switching capture after the main isolated run.
import { _electron } from 'playwright-core'
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const demo = process.env.GUIDE_DEMO_ROOT || '/tmp/research-notebook-guide-demo'
if (!resolve(demo).startsWith('/tmp/research-notebook-guide-')) throw Error('Use an isolated guide demo root.')
const out = join(root, 'docs/images/guide')
const index = JSON.parse(await readFile(join(out, 'capture-index.json'), 'utf8'))
if (!index.complete) throw Error('Complete the main fresh capture first.')
await mkdir(join(demo, 'fixtures'), { recursive: true })
const fixture = join(demo, 'fixtures/comparison-reading.pdf')
await copyFile(process.env.GUIDE_PDF || '/home/mk/Documents/think-python-2nd.pdf', fixture)
const app = await _electron.launch({
  executablePath: join(root, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', root],
  cwd: root,
  env: { ...process.env, XDG_CONFIG_HOME: join(demo, 'config') }
})
try {
  const page = await app.firstWindow()
  await page.waitForTimeout(1200)
  if (!(await app.evaluate(({ app }) => app.getPath('userData'))).startsWith(demo + '/'))
    throw Error('Isolation failed')
  await page.getByRole('button', { name: 'Practice captures', exact: true }).first().click()
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await page.waitForTimeout(900)
  await app.evaluate(({ dialog }, fixture) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] })
  }, fixture)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.waitForTimeout(700)
  const select = page.getByLabel('Source document', { exact: true })
  const options = await select
    .locator('option')
    .evaluateAll((items) => items.filter((o) => o.value).map((o) => ({ value: o.value, text: o.textContent })))
  const second = options.find((o) => o.text.includes('comparison-reading'))
  if (!second || options.length < 2) throw Error('Second source missing')
  await select.selectOption(second.value)
  await page.getByLabel('PDF page', { exact: true }).fill('23')
  await page.waitForTimeout(1000)
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await page.waitForTimeout(800)
  await page.locator('.source-pane').evaluate((e) => (e.scrollTop = 0))
  const pane = await page.locator('.source-pane').boundingBox()
  const clip = {
    x: Math.floor(pane.x),
    y: Math.floor(pane.y),
    width: Math.floor(pane.width),
    height: Math.min(500, Math.floor(pane.height))
  }
  const marks = []
  for (const [n, loc, description] of [
    [1, select, 'Source document selector'],
    [2, page.locator('.source-header h2'), 'Selected comparison PDF title']
  ]) {
    const b = await loc.boundingBox()
    marks.push({ n, description, x: b.x - clip.x, y: b.y - clip.y, width: b.width, height: b.height })
  }
  const id = '38-source-switch'
  const png = join(out, 'originals', id + '.png')
  await page.screenshot({ path: png, clip })
  const overlay = marks
    .map(
      (b) =>
        `<rect x="${b.x - 3}" y="${b.y - 3}" width="${b.width + 6}" height="${b.height + 6}" rx="4" fill="none" stroke="white" stroke-width="5"/><rect x="${b.x - 3}" y="${b.y - 3}" width="${b.width + 6}" height="${b.height + 6}" rx="4" fill="none" stroke="#d42816" stroke-width="2.5"/><circle cx="${b.x + b.width + 3}" cy="${b.y}" r="12" fill="#b91c1c" stroke="white" stroke-width="2"/><text x="${b.x + b.width + 3}" y="${b.y + 4}" fill="white" font-family="Arial,sans-serif" font-size="13" font-weight="bold" text-anchor="middle">${b.n}</text>`
    )
    .join('')
  const wrap = (s) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${clip.width}" height="${clip.height}" viewBox="0 0 ${clip.width} ${clip.height}" role="img"><title>Switching to a second imported comparison PDF</title>${s}</svg>`
  await writeFile(join(out, 'overlays', id + '.svg'), wrap(overlay))
  await writeFile(
    join(out, id + '.svg'),
    wrap(
      `<image width="${clip.width}" height="${clip.height}" href="data:image/png;base64,${(await readFile(png)).toString('base64')}"/>` +
        overlay
    )
  )
  await select.selectOption(options.find((o) => o.value !== second.value).value)
  await page.waitForTimeout(900)
  index.captures = index.captures.filter((c) => c.id !== id)
  index.captures.push({ id, width: clip.width, height: clip.height, markers: marks })
  index.observations.push(
    'Imported a second nonprivate PDF copy, switched to it and back using Source document; actual selected second-source state captured.'
  )
  await writeFile(join(out, 'capture-index.json'), JSON.stringify(index, null, 2) + '\n')
  console.log('Source switching verified and captured.')
} finally {
  await app.close()
}
