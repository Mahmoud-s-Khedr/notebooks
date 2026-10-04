import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NotebookDatabase } from './database'
import { applyMigration, migrations, runMigrations } from './migrations'

describe('disk schema migrations', () => {
  const directories: string[] = []
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

  it('creates each historical version and upgrades it through the normal database bootstrap', () => {
    for (const historical of migrations) {
      const directory = mkdtempSync(join(tmpdir(), `research-notebook-v${historical.version}-`))
      directories.push(directory)
      const path = join(directory, 'database.sqlite')
      const old = new Database(path)
      old.pragma('foreign_keys = ON')
      runMigrations(old, historical.version)
      expect(
        (old.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version
      ).toBe(historical.version)
      old.close()

      const upgraded = new NotebookDatabase(path)
      expect(upgraded.connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({
        count: migrations.length
      })
      expect(
        upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='error_events'").get()
      ).toBeTruthy()
      upgraded.close()
    }
  })

  it('is idempotent and preserves indexes and foreign-key enforcement on reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-notebook-schema-'))
    directories.push(directory)
    const path = join(directory, 'database.sqlite')
    const first = new NotebookDatabase(path)
    const count = first.connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()
    expect(
      first.connection
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='pages_notebook_position_idx'")
        .get()
    ).toBeTruthy()
    expect(first.connection.pragma('foreign_keys', { simple: true })).toBe(1)
    first.close()
    const second = new NotebookDatabase(path)
    expect(second.connection.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual(count)
    second.close()
  })

  it('rolls a failed migration back completely, including its migration record', () => {
    const database = new Database(':memory:')
    runMigrations(database, 1)
    expect(() =>
      applyMigration(database, {
        version: 99,
        name: 'broken_test_migration',
        sql: 'CREATE TABLE should_not_survive (id TEXT); INSERT INTO missing_table VALUES (1);'
      })
    ).toThrow()
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='should_not_survive'").get()
    ).toBeUndefined()
    expect(database.prepare('SELECT version FROM schema_migrations WHERE version=99').get()).toBeUndefined()
    database.close()
  })
})
