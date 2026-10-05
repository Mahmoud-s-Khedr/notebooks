import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

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
  const entries = Object.entries(manifest).filter(([relativePath]) => relativePath.startsWith(`${platform}/`))
  const binaryPath = join(root, platform, filename)
  if (!entries.some(([relativePath]) => relativePath === `${platform}/${filename}`) || !existsSync(binaryPath))
    throw new Error(`Missing pinned whisper.cpp sidecar for ${platform}.`)
  for (const [relativePath, expected] of entries) {
    const path = join(root, relativePath)
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected) || !existsSync(path))
      throw new Error(`Missing pinned whisper.cpp sidecar dependency: ${relativePath}.`)
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (actual !== expected) throw new Error(`Checksum mismatch for ${relativePath}.`)
  }

  // whisper.cpp v1.8 uses several shared ggml objects. Validate the actual
  // loader path, rather than checking only libwhisper and missing a transitive
  // dependency such as libggml.so.0 or libggml-base.so.0.
  if (platform === 'linux' && process.platform === 'linux') {
    const result = spawnSync(binaryPath, ['--help'], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, LD_LIBRARY_PATH: join(root, platform) }
    })
    if (result.error) throw new Error(`Linux Whisper sidecar smoke test could not start: ${result.error.message}`)
    if (result.status !== 0)
      throw new Error(`Linux Whisper sidecar smoke test failed: ${(result.stderr || result.stdout).trim()}`)
  }
}
