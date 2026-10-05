import { _electron } from 'playwright-core'
import { readFile, writeFile, readdir, mkdir, cp, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const demo = process.env.GUIDE_DEMO_ROOT || '/tmp/research-notebook-guide-demo'
if (!resolve(demo).startsWith('/tmp/research-notebook-guide-'))
  throw Error('Use the isolated /tmp/research-notebook-guide-* capture directory.')
const exports = join(demo, 'exports')
const dirs = await readdir(exports, { withFileTypes: true })
const checked = []
let backup
for (const dir of dirs.filter((d) => d.isDirectory())) {
  const path = join(exports, dir.name)
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'))
  if (dir.name.startsWith('research-notebook-backup-')) {
    backup = path
    for (const asset of manifest.assets) {
      const bytes = await readFile(join(path, asset.path))
      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw Error('Backup hash mismatch')
    }
    await readFile(join(path, 'RECOVERY.md'))
    checked.push({ kind: 'library-backup', assetHashes: manifest.assets.length })
    continue
  }
  if (manifest.format === 'lossless-json') {
    const archive = JSON.parse(await readFile(join(path, 'notebook.lossless.v1.json'), 'utf8'))
    for (const asset of archive.assets) {
      if (
        createHash('sha256')
          .update(await readFile(join(path, asset.exportPath)))
          .digest('hex') !== asset.sha256
      )
        throw Error('Export hash mismatch')
    }
    if (!archive.sources.length || !archive.relations.length) throw Error('Source/relation archive missing')
    checked.push({
      format: manifest.format,
      scope: manifest.scope.type,
      assets: archive.assets.length,
      sources: archive.sources.length,
      relations: archive.relations.length
    })
  } else if (manifest.format === 'pdf') {
    if (!(await readFile(join(path, 'notebook.pdf'))).subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw Error('PDF signature absent')
    checked.push({ format: 'pdf', scope: manifest.scope.type })
  } else {
    const text = await readFile(join(path, 'notebook.md'), 'utf8')
    if (!text.startsWith('# ')) throw Error('Markdown heading missing')
    if (manifest.format === 'ai-context' && !text.includes('[AUDIO]')) throw Error('AI semantic labels absent')
    for (const asset of manifest.assets) await stat(join(path, asset.path))
    checked.push({ format: manifest.format, scope: manifest.scope.type, assets: manifest.assets.length })
  }
}
if (new Set(checked.filter((c) => c.format).map((c) => c.format)).size !== 4 || !backup)
  throw Error('Missing export/backup format')
const recovery = join(demo, 'recovery-check-' + Date.now())
const userData = join(recovery, 'research-notebook')
await mkdir(userData, { recursive: true })
await cp(join(backup, 'database.sqlite'), join(userData, 'database.sqlite'))
await cp(join(backup, 'assets'), join(userData, 'assets'), { recursive: true })
const app = await _electron.launch({
  executablePath: join(root, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', root],
  cwd: root,
  env: { ...process.env, XDG_CONFIG_HOME: recovery }
})
let restored
try {
  const page = await app.firstWindow()
  await page.waitForTimeout(1000)
  if ((await app.evaluate(({ app }) => app.getPath('userData'))) !== userData) throw Error('Recovery isolation failed')
  restored = await page.evaluate(async () => {
    const api = window.researchNotebook
    const tree = await api.notebooks.list()
    const workspaces = []
    for (const nb of tree) for (const p of nb.pages) workspaces.push(await api.pages.getWorkspace({ pageId: p.id }))
    const blocks = workspaces.flatMap((w) => w.notes.flatMap((n) => n.blocks))
    for (const block of blocks.filter((b) => typeof b.data.assetId === 'string')) {
      const url = await api.assets.dataUrl({ assetId: block.data.assetId })
      if (!url.startsWith('data:')) throw Error('Restored asset missing')
    }
    return {
      notebooks: tree.length,
      pages: workspaces.length,
      blocks: blocks.length,
      sourceLinks: blocks.filter((b) => b.data.sourceDocumentId).length,
      audio: blocks.filter((b) => b.type === 'audio').length
    }
  })
  if (restored.notebooks !== 1 || restored.pages !== 2 || !restored.sourceLinks || !restored.audio)
    throw Error('Unexpected restored content ' + JSON.stringify(restored))
} finally {
  await app.close()
}
const report = {
  verifiedAt: new Date().toISOString(),
  version: '0.1.0',
  exports: checked,
  disposableFilesystemRecovery: restored,
  method:
    'Copied backup database.sqlite/assets into a fresh isolated profile; verified app content and asset loading. No lossless import used for recovery.'
}
await writeFile(join(root, 'docs/guide-verification.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
