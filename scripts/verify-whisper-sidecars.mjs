import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.cwd(), 'resources', 'whisper.cpp')
const manifestPath = join(root, 'checksums.json')
if (!existsSync(manifestPath)) throw new Error('Missing resources/whisper.cpp/checksums.json; sidecar packaging is intentionally blocked.')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
for (const [platform, filename] of [['linux', 'whisper-cli'], ['win32', 'whisper-cli.exe']]) {
  const path = join(root, platform, filename); const expected = manifest[`${platform}/${filename}`]
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected) || !existsSync(path)) throw new Error(`Missing pinned whisper.cpp sidecar for ${platform}.`)
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex'); if (actual !== expected) throw new Error(`Checksum mismatch for ${platform} whisper.cpp sidecar.`)
}
