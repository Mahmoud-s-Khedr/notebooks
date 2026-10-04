import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NotebookDatabase } from '../database/database'
import { ErrorLogService, appendFallbackError } from './error-log-service'

describe('ErrorLogService', () => {
  const directories: string[] = []
  const databases: NotebookDatabase[] = []
  afterEach(() => {
    databases.splice(0).forEach((database) => database.close())
    directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  })

  it('preserves local diagnostic detail while redacting credentials', () => {
    const database = new NotebookDatabase(':memory:')
    databases.push(database)
    const logger = new ErrorLogService(database.connection, join(tmpdir(), 'unused-errors.ndjson'), '1.2.3', true)
    logger.record(new Error('Upload failed at /tmp/notebook/file.pdf token=super-secret-value'), {
      process: 'service',
      layer: 'upload',
      category: 'asset.upload',
      context: { path: '/tmp/notebook/file.pdf', authorization: 'Bearer secret-token-value' }
    })
    const event = logger.list()[0]
    expect(event.message).toContain('/tmp/notebook/file.pdf')
    expect(event.message).toContain('[REDACTED]')
    expect(JSON.stringify(event.context)).toContain('[REDACTED]')
    expect(event.appVersion).toBe('1.2.3')
  })

  it('imports errors saved while SQLite was unavailable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-notebook-errors-'))
    directories.push(directory)
    const fallback = join(directory, 'error-events-fallback.ndjson')
    appendFallbackError(fallback, new Error('Database startup failed'), {
      process: 'lifecycle',
      layer: 'electron',
      category: 'startup.database'
    })
    const database = new NotebookDatabase(':memory:')
    databases.push(database)
    const logger = new ErrorLogService(database.connection, fallback, 'test', true)
    expect(logger.list()[0]).toMatchObject({ category: 'startup.database', message: 'Database startup failed' })
  })

  it('stores cause chains, correlation IDs, and filterable full details', () => {
    const database = new NotebookDatabase(':memory:')
    databases.push(database)
    const logger = new ErrorLogService(database.connection, join(tmpdir(), 'unused-errors.ndjson'), '1.2.3', true)
    const root = new Error('Socket timeout')
    const error = new Error('Could not upload /tmp/source.pdf', { cause: root })
    logger.record(error, {
      process: 'service',
      layer: 'upload',
      category: 'asset.upload',
      code: 'UPLOAD_FAILED',
      operationId: 'operation-42',
      ipcId: 'ipc-42',
      context: { localPath: '/tmp/source.pdf' }
    })
    logger.record(new Error('Renderer failed'), { process: 'renderer', layer: 'renderer', category: 'render' })
    const event = logger.list({ process: 'service', category: 'asset.upload', limit: 1 })[0]
    expect(event).toMatchObject({
      code: 'UPLOAD_FAILED',
      operationId: 'operation-42',
      ipcId: 'ipc-42',
      appVersion: '1.2.3',
      context: { localPath: '/tmp/source.pdf' }
    })
    expect(event.stack).toContain('Could not upload')
    expect(event.causeChain).toContain('Socket timeout')
    expect(logger.get(event.id)).toEqual(event)
    expect(logger.list({ severity: 'fatal' })).toEqual([])
  })

  it('keeps only the newest 5,000 records in release mode', () => {
    const database = new NotebookDatabase(':memory:')
    databases.push(database)
    const logger = new ErrorLogService(database.connection, join(tmpdir(), 'unused-errors.ndjson'), 'release', false)
    for (let index = 0; index < 5_002; index += 1)
      logger.record(new Error(`release-event-${index}`), { process: 'main', layer: 'test', category: 'retention' })
    const rows = database.connection.prepare('SELECT COUNT(*) AS count FROM error_events').get() as { count: number }
    expect(rows.count).toBe(5_000)
    expect(logger.list({ category: 'retention', limit: 1 })[0].message).toBe('release-event-5001')
  }, 30_000)

  it('falls back without throwing if the database becomes unavailable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-notebook-errors-'))
    directories.push(directory)
    const fallback = join(directory, 'error-events-fallback.ndjson')
    const database = new NotebookDatabase(':memory:')
    databases.push(database)
    const logger = new ErrorLogService(database.connection, fallback, 'test', true)
    database.close()
    databases.pop()
    expect(() =>
      logger.record(new Error('Write after close'), {
        process: 'main',
        layer: 'test',
        category: 'database.unavailable'
      })
    ).not.toThrow()
    expect(existsSync(fallback)).toBe(true)
    expect(readFileSync(fallback, 'utf8')).toContain('Write after close')
  })
})
