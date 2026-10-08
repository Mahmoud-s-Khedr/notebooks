import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { TestLibrary } from '../test-support'
import { JobService } from './job-service'

let library: TestLibrary
let jobs: JobService
beforeEach(() => {
  library = new TestLibrary()
  jobs = new JobService(library.database.connection, undefined, 1)
})
afterEach(async () => {
  await Promise.resolve()
  await Promise.resolve()
  library.close()
})
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
describe('job queue lifecycle', () => {
  it('clamps progress, cancels queued work and runs the next job after completion', async () => {
    let complete!: (value: Record<string, unknown>) => void
    let checkpoint!: (value: number) => void
    jobs.register('backup', async (_payload, update) => {
      checkpoint = update
      return new Promise((resolve) => {
        complete = resolve
      })
    })
    const running = jobs.start('backup', { option: true })
    const queued = jobs.start('backup', {})
    checkpoint(-10)
    expect(jobs.get(running.id).progress).toBe(0)
    checkpoint(123)
    expect(jobs.get(running.id).progress).toBe(99)
    expect(jobs.cancel(queued.id).status).toBe('cancelled')
    expect(() => jobs.retry(running.id)).toThrow('Only failed or cancelled')
    complete({ destination: 'backup' })
    await settle()
    expect(jobs.get(running.id)).toMatchObject({
      status: 'completed',
      progress: 100,
      result: { destination: 'backup' }
    })
    expect(jobs.cancel(running.id).status).toBe('completed')
    expect(jobs.diagnostics()).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'completed' })]))
  })
  it.each([false, true])('cancels running work even when the handler throws (%s)', async (throws) => {
    let finish!: () => void
    let checkpoint!: (value: number) => void
    let cancelled!: () => boolean
    jobs.register('backup', async (_payload, update, isCancelled) => {
      checkpoint = update
      cancelled = isCancelled
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      if (throws) throw new Error('cancelled handler')
      return { ignored: true }
    })
    const started = jobs.start('backup', {})
    jobs.cancel(started.id)
    expect(cancelled()).toBe(true)
    checkpoint(80)
    expect(jobs.get(started.id).progress).toBe(0)
    finish()
    await settle()
    expect(jobs.get(started.id)).toMatchObject({ status: 'cancelled', result: null })
    expect(jobs.diagnostics()).toEqual(
      expect.arrayContaining([expect.objectContaining({ outcome: 'cancelled', code: null })])
    )
  })
  it('retries failed work with original options and exports diagnostic history', async () => {
    const handler = vi.fn().mockRejectedValueOnce('plain failure').mockResolvedValue({ done: true })
    jobs.register('backup', handler)
    const failed = jobs.start('backup', { option: 'value' })
    await settle()
    expect(jobs.get(failed.id)).toMatchObject({ status: 'failed', errorMessage: 'plain failure' })
    const retry = jobs.retry(failed.id)
    await settle()
    expect(jobs.get(retry.id).status).toBe('completed')
    expect(handler.mock.calls[1][0]).toEqual({ option: 'value', retryOf: failed.id })
    const path = jobs.exportDiagnostics(library.root)
    expect(readFileSync(path, 'utf8')).toContain('plain failure')
    expect(jobs.list()).toHaveLength(2)
  })
  it('fails unsupported jobs and rejects missing IDs', async () => {
    const unsupported = jobs.start('export', {})
    await settle()
    expect(jobs.get(unsupported.id)).toMatchObject({ status: 'failed', errorMessage: 'Unsupported job type.' })
    expect(() => jobs.get('missing')).toThrow('Job not found')
    jobs.resume()
    await settle()
    expect(jobs.get(unsupported.id).attempts).toBe(1)
  })
})
