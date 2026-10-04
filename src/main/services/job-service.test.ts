import { afterEach, describe, expect, it } from 'vitest'
import { NotebookDatabase } from '../database/database'
import { ErrorLogService } from './error-log-service'
import { JobService } from './job-service'

const until = async (predicate: () => boolean, timeout = 2_000): Promise<void> => {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for background job.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('JobService error diagnostics', () => {
  const databases: NotebookDatabase[] = []
  afterEach(() => databases.splice(0).forEach((database) => database.close()))

  it('records the underlying job failure without changing the user-facing job error', async () => {
    const database = new NotebookDatabase(':memory:'); databases.push(database)
    const errors = new ErrorLogService(database.connection, '/tmp/unused-job-errors.ndjson', 'test', true)
    const jobs = new JobService(database.connection, errors)
    jobs.register('backup', async () => { throw new Error('Backup failed at /tmp/library/database.sqlite token=do-not-save') })
    const job = jobs.start('backup', {})
    await until(() => jobs.get(job.id).status === 'failed')
    expect(jobs.get(job.id).errorMessage).toContain('[path redacted]')
    const event = errors.list({ process: 'job' })[0]
    expect(event).toMatchObject({ category: 'backup', code: 'JOB_FAILED', operationId: job.id, context: { jobId: job.id } })
    expect(event.message).toContain('/tmp/library/database.sqlite')
    expect(event.message).toContain('[REDACTED]')
  })
})
