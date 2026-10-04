import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NotebookDatabase } from '../database/database'
import { ErrorLogService, appendFallbackError } from './error-log-service'

describe('ErrorLogService', () => {
  const directories: string[] = []
  const databases: NotebookDatabase[] = []
  afterEach(() => { databases.splice(0).forEach((database) => database.close()); directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })) })

  it('preserves local diagnostic detail while redacting credentials', () => {
    const database = new NotebookDatabase(':memory:'); databases.push(database)
    const logger = new ErrorLogService(database.connection, join(tmpdir(), 'unused-errors.ndjson'), '1.2.3', true)
    logger.record(new Error('Upload failed at /tmp/notebook/file.pdf token=super-secret-value'), { process: 'service', layer: 'upload', category: 'asset.upload', context: { path: '/tmp/notebook/file.pdf', authorization: 'Bearer secret-token-value' } })
    const event = logger.list()[0]
    expect(event.message).toContain('/tmp/notebook/file.pdf')
    expect(event.message).toContain('[REDACTED]')
    expect(JSON.stringify(event.context)).toContain('[REDACTED]')
    expect(event.appVersion).toBe('1.2.3')
  })

  it('imports errors saved while SQLite was unavailable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-notebook-errors-')); directories.push(directory)
    const fallback = join(directory, 'error-events-fallback.ndjson')
    appendFallbackError(fallback, new Error('Database startup failed'), { process: 'lifecycle', layer: 'electron', category: 'startup.database' })
    const database = new NotebookDatabase(':memory:'); databases.push(database)
    const logger = new ErrorLogService(database.connection, fallback, 'test', true)
    expect(logger.list()[0]).toMatchObject({ category: 'startup.database', message: 'Database startup failed' })
  })
})
