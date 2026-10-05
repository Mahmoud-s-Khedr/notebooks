// Supplemental model and local-key controls. Cloud transcription is never invoked.
import { _electron } from 'playwright-core'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const demo = process.env.GUIDE_DEMO_ROOT || '/tmp/research-notebook-guide-demo'
if (!resolve(demo).startsWith('/tmp/research-notebook-guide-')) throw Error('Use an isolated guide demo root.')
const out = join(root, 'docs/images/guide')
const index = JSON.parse(await readFile(join(out, 'capture-index.json'), 'utf8'))
if (!index.complete) throw Error('Complete the main capture first.')
let app = await _electron.launch({
  executablePath: join(root, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', root],
  cwd: root,
  env: { ...process.env, XDG_CONFIG_HOME: join(demo, 'config') }
})
try {
  const page = await app.firstWindow()
  await page.waitForTimeout(1000)
  if (!(await app.evaluate(({ app }) => app.getPath('userData'))).startsWith(demo + '/'))
    throw Error('Isolation failed')
  page.on('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Application menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'settings', exact: true }).click()
  await page.getByRole('button', { name: 'Transcription', exact: true }).click()
  await page.waitForTimeout(500)
  const cards = page.locator('.model-card'),
    tiny = cards.nth(0),
    base = cards.nth(1)
  async function install(card) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if ((await card.innerText()).includes('Installed')) return true
      const start = card.getByRole('button', { name: /^Download$|^Retry$/ })
      if (await start.count()) await start.click()
      for (let i = 0; i < 120; i++) {
        await page.waitForTimeout(1000)
        const text = await card.innerText()
        if (i % 10 === 0) console.log(text.replaceAll('\n', ' · '))
        if (text.includes('Installed')) return true
        if (await card.getByRole('button', { name: 'Retry', exact: true }).count()) break
      }
    }
    const cancel = card.getByRole('button', { name: 'Cancel', exact: true })
    if (await cancel.count()) await cancel.click()
    return false
  }
  async function capture(id, focus, targets) {
    const r = await focus.boundingBox()
    if (id === '39-installed-models' || id === '41-model-default') {
      const last = await base.boundingBox()
      r.height = last.y + last.height - r.y
    }
    const clip = {
      x: Math.floor(r.x) - 4,
      y: Math.floor(r.y) - 4,
      width: Math.ceil(r.width) + 8,
      height: Math.ceil(r.height) + 8
    }
    const markers = []
    for (const [n, loc, description] of targets) {
      const b = await loc.boundingBox()
      markers.push({ n, description, x: b.x - clip.x, y: b.y - clip.y, width: b.width, height: b.height })
    }
    await page.screenshot({ path: join(out, 'originals', id + '.png'), clip })
    index.captures = index.captures.filter((c) => c.id !== id)
    index.captures.push({ id, width: clip.width, height: clip.height, markers })
    console.log('Captured ' + id)
  }
  const tinyInstalled = await install(tiny),
    baseInstalled = await install(base)
  if (tinyInstalled && baseInstalled) {
    const useBase = base.getByRole('button', { name: 'Use as default', exact: true })
    if (await useBase.count()) await useBase.click()
    await page.waitForTimeout(1200)
    await capture('39-installed-models', page.locator('.model-list'), [
      [1, tiny, 'Installed Tiny model'],
      [2, tiny.getByRole('button', { name: 'Use as default', exact: true }), 'Use as default'],
      [3, tiny.getByRole('button', { name: 'Remove', exact: true }), 'Remove nondefault model'],
      [4, base.getByRole('button', { name: 'Default', exact: true }), 'Current Base default']
    ])
    await tiny.getByRole('button', { name: 'Use as default', exact: true }).click()
    await page.waitForTimeout(1200)
    await capture('41-model-default', page.locator('.model-list'), [
      [1, tiny.getByRole('button', { name: 'Default', exact: true }), 'Tiny default'],
      [2, base.getByRole('button', { name: 'Remove', exact: true }), 'Remove Base model']
    ])
    await base.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.waitForTimeout(1200)
    if (!(await base.innerText()).includes('Not installed')) throw Error('Model removal failed')
    await capture('42-model-removed', base, [
      [1, base, 'Base model removed'],
      [2, base.getByRole('button', { name: 'Download', exact: true }), 'Download again']
    ])
    index.observations.push(
      'Installed and checksum-verified Tiny and Base through actual downloads; changed default Base→Tiny; confirmed and removed the nondefault Base model. Local runtime remains absent.'
    )
  } else {
    index.observations.push(
      'Model completion attempt: Tiny installed=' +
        tinyInstalled +
        ', Base installed=' +
        baseInstalled +
        '. No unobserved model state fabricated.'
    )
    throw Error('Model prerequisite unavailable; adjust the manual to actual captured states.')
  }
  await page.getByPlaceholder('Enter API key').fill('guide-dummy-key-not-a-provider-credential')
  await page.getByRole('button', { name: 'Save key', exact: true }).click()
  await page.waitForTimeout(600)
  await capture('40-key-controls', page.locator('.settings-card').first(), [
    [1, page.getByPlaceholder('Enter API key'), 'Replace API key field'],
    [2, page.getByRole('button', { name: 'Replace key', exact: true }), 'Replace key'],
    [3, page.getByRole('button', { name: 'Remove key', exact: true }), 'Remove key']
  ])
  await page.getByPlaceholder('Enter API key').fill('guide-second-dummy-local-key')
  await page.getByRole('button', { name: 'Replace key', exact: true }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Remove key', exact: true }).click()
  await page.getByRole('button', { name: 'Save key', exact: true }).waitFor()
  index.observations.push(
    'Saved, replaced and removed a dummy local key. No provider authentication or external audio request was made.'
  )
  await app.close()
  app = await _electron.launch({
    executablePath: join(root, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', root],
    cwd: root,
    env: { ...process.env, XDG_CONFIG_HOME: join(demo, 'config') }
  })
  const restarted = await app.firstWindow()
  await restarted.waitForTimeout(800)
  const persisted = await restarted.evaluate(async () => ({
    config: await window.researchNotebook.settings.transcription(),
    models: await window.researchNotebook.settings.models()
  }))
  if (
    persisted.config.selectedLocalModel?.id !== 'ggml-tiny.bin' ||
    persisted.config.openRouterConfigured ||
    persisted.models.find((m) => m.id === 'ggml-base.bin').installed
  )
    throw Error('Model/key state did not persist')
  index.observations.push(
    'After restart, Tiny remained the default, Base remained removed, and no dummy key was configured.'
  )
  console.log('Model and key workflows verified.')
} finally {
  await app.close()
  await writeFile(join(out, 'capture-index.json'), JSON.stringify(index, null, 2) + '\n')
}
