import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotebookDatabase } from './database/database'
import { NotebookService } from './services/notebook-service'
import type { Job } from '../shared/domain'

/** Disposable, disk-backed library used by main-process safety integration tests. */
export class TestLibrary {
  readonly root = mkdtempSync(join(tmpdir(), 'research-notebook-safety-'))
  readonly assets = join(this.root, 'assets')
  readonly config = join(this.root, 'config')
  readonly database = new NotebookDatabase(join(this.root, 'database.sqlite'))
  readonly service = new NotebookService(this.database, this.assets, this.config)

  close(): void {
    this.database.close()
    rmSync(this.root, { recursive: true, force: true })
  }
}

export const validWav = (samples = 1600): Buffer => {
  const wav = Buffer.alloc(44 + samples * 2)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24)
  wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(samples * 2, 40)
  return wav
}

export const writeFixture = (directory: string, name: string, bytes: Buffer | string): string => {
  const path = join(directory, name)
  writeFileSync(path, bytes)
  return path
}

export async function waitForJob(service: NotebookService, job: Job, timeout = 4_000): Promise<Job> {
  const until = Date.now() + timeout
  for (;;) {
    const current = service.listJobs().find(({ id }) => id === job.id)!
    if (['completed', 'failed', 'cancelled'].includes(current.status)) return current
    if (Date.now() > until) throw new Error(`Timed out waiting for ${job.kind} job.`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export function assertNoStaging(directory: string): void {
  const names = existsSync(directory) ? readdirSync(directory) : []
  const residue = names.filter(
    (name) => name.includes('.staging') || name.includes('.tmp') || name.startsWith('.import-')
  )
  if (residue.length) throw new Error(`Unexpected staging residue: ${residue.join(', ')}`)
}
