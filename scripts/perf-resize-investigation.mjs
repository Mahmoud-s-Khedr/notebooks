/** Read-only resize investigation using existing disposable benchmark profiles. */
import { _electron } from './guide/node_modules/playwright-core/index.mjs'
import { resolve, join } from 'node:path'
import { writeFile } from 'node:fs/promises'
const root = resolve('.')
const profile = process.env.PERF_LIBRARY_ROOT
if (!profile?.startsWith('/tmp/notebook-performance-')) throw Error('Use a disposable benchmark profile')
const app = await _electron.launch({
  executablePath: join(root, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', process.env.PERF_APP_ROOT || root],
  env: { ...process.env, XDG_CONFIG_HOME: profile }
})
try {
  const page = await app.firstWindow()
  await page.getByRole('button', { name: 'paginated-notes', exact: true }).click()
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await page.locator('.pdf-stage canvas').waitFor()
  await page.waitForTimeout(500)
  while (await page.locator('.zoom-label').evaluate((e) => parseInt(e.textContent, 10) > 190)) {
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await page.waitForTimeout(30)
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const metrics = async () =>
    Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const samples = []
  for (let run = 0; run < 5; run++) {
    await page.evaluate(() => {
      window.resizeMeasurement = null
      window.addEventListener(
        'resize',
        () => {
          const start = performance.now()
          requestAnimationFrame(() => {
            window.resizeMeasurement = performance.now() - start
          })
        },
        { once: true }
      )
    })
    const before = await metrics()
    const start = Date.now()
    await app.evaluate(
      ({ BrowserWindow }, small) => BrowserWindow.getAllWindows()[0].setSize(small ? 1100 : 1440, 900),
      run % 2 === 0
    )
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const harnessMs = Date.now() - start
    await page.waitForFunction(() => window.resizeMeasurement !== null)
    const eventToFrameMs = await page.evaluate(() => window.resizeMeasurement)
    const after = await metrics()
    const deltas = Object.fromEntries(
      ['LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'].map((name) => [
        name + 'Ms',
        (after[name] - before[name]) * 1000
      ])
    )
    samples.push({ harnessMs, eventToFrameMs, ...deltas })
  }
  const medians = Object.fromEntries(
    Object.keys(samples[0]).map((key) => [key, samples.map((s) => s[key]).sort((a, b) => a - b)[2]])
  )
  await writeFile(
    process.env.PERF_OUTPUT,
    JSON.stringify({ appRoot: process.env.PERF_APP_ROOT || root, samples, medians }, null, 2) + '\n'
  )
} finally {
  await app.close()
}
