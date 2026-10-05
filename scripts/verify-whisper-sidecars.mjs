import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.cwd(), 'resources', 'whisper.cpp')
const manifestPath = join(root, 'checksums.json')
if (!existsSync(manifestPath))
  throw new Error('Missing resources/whisper.cpp/checksums.json; sidecar packaging is intentionally blocked.')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const allSidecars = [
  ['linux', 'whisper-cli'],
  ['win32', 'whisper-cli.exe']
]
const requestedPlatform = process.env.WHISPER_SIDECAR_PLATFORM
if (requestedPlatform && !['linux', 'win32'].includes(requestedPlatform))
  throw new Error(`Unsupported Whisper sidecar platform: ${requestedPlatform}`)
const sidecars = requestedPlatform ? allSidecars.filter(([platform]) => platform === requestedPlatform) : allSidecars
for (const [platform, filename] of sidecars) {
  const path = join(root, platform, filename)
  const expected = manifest[`${platform}/${filename}`]
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected) || !existsSync(path))
    throw new Error(`Missing pinned whisper.cpp sidecar for ${platform}.`)
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (actual !== expected) throw new Error(`Checksum mismatch for ${platform} whisper.cpp sidecar.`)
  // The Linux CLI is dynamically linked. The loader requests this exact SONAME,
  // so the file (or symlink) must travel with the executable into extraResources.
  if (platform === 'linux' && !existsSync(join(root, platform, 'libwhisper.so.1')))
    throw new Error('Missing resources/whisper.cpp/linux/libwhisper.so.1 required by the Linux Whisper sidecar.')
}
