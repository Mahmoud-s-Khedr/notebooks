import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { runMigrations } from './migrations'

export class NotebookDatabase {
  readonly connection: Database.Database
  readonly path: string

  constructor(databasePath: string) {
    this.path = databasePath
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
    this.connection = new Database(databasePath)
    this.connection.pragma('foreign_keys = ON')
    this.connection.pragma('journal_mode = WAL')
    this.connection.pragma('synchronous = NORMAL')
    this.connection.pragma('busy_timeout = 5000')
    runMigrations(this.connection)
  }

  close(): void {
    this.connection.close()
  }
}
