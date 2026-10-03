import type Database from 'better-sqlite3'

interface Migration {
  version: number
  name: string
  sql: string
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'foundational_research_notebook_schema',
    sql: `
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE pages (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(notebook_id, position)
      );
      CREATE INDEX pages_notebook_position_idx ON pages(notebook_id, position);

      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(page_id, position)
      );
      CREATE INDEX notes_page_position_idx ON notes(page_id, position);

      CREATE TABLE blocks (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        position INTEGER NOT NULL,
        data_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(note_id, position)
      );
      CREATE INDEX blocks_note_position_idx ON blocks(note_id, position);

      CREATE TABLE source_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        relative_path TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE block_sources (
        id TEXT PRIMARY KEY,
        block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
        source_document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
        selection_type TEXT NOT NULL,
        pdf_page INTEGER,
        printed_page INTEGER,
        bounds_json TEXT,
        extracted_text TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX block_sources_block_idx ON block_sources(block_id);

      CREATE TABLE block_relations (
        id TEXT PRIMARY KEY,
        from_block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
        to_block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(from_block_id, to_block_id, relation_type)
      );

      CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE RESTRICT,
        kind TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        original_filename TEXT,
        mime_type TEXT,
        byte_size INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    name: 'recoverable_deletion_and_local_search',
    sql: `
      ALTER TABLE notebooks ADD COLUMN deleted_at TEXT;
      ALTER TABLE notebooks ADD COLUMN deletion_operation_id TEXT;
      ALTER TABLE pages ADD COLUMN deleted_at TEXT;
      ALTER TABLE pages ADD COLUMN deletion_operation_id TEXT;
      ALTER TABLE notes ADD COLUMN deleted_at TEXT;
      ALTER TABLE notes ADD COLUMN deletion_operation_id TEXT;
      ALTER TABLE blocks ADD COLUMN deleted_at TEXT;
      ALTER TABLE blocks ADD COLUMN deletion_operation_id TEXT;

      CREATE INDEX notebooks_active_idx ON notebooks(deleted_at, updated_at);
      CREATE INDEX pages_active_idx ON pages(notebook_id, deleted_at, position);
      CREATE INDEX notes_active_idx ON notes(page_id, deleted_at, position);
      CREATE INDEX blocks_active_idx ON blocks(note_id, deleted_at, position);

      CREATE VIRTUAL TABLE search_index USING fts5(
        entity_type,
        entity_id UNINDEXED,
        notebook_id UNINDEXED,
        page_id UNINDEXED,
        note_id UNINDEXED,
        title,
        content,
        tokenize = 'unicode61'
      );

      INSERT INTO search_index (entity_type, entity_id, notebook_id, page_id, note_id, title, content)
        SELECT 'notebook', id, id, NULL, NULL, title, title FROM notebooks WHERE deleted_at IS NULL;
      INSERT INTO search_index (entity_type, entity_id, notebook_id, page_id, note_id, title, content)
        SELECT 'page', id, notebook_id, id, NULL, title, title FROM pages WHERE deleted_at IS NULL;
      INSERT INTO search_index (entity_type, entity_id, notebook_id, page_id, note_id, title, content)
        SELECT 'note', notes.id, pages.notebook_id, notes.page_id, notes.id, notes.title, notes.title
        FROM notes JOIN pages ON pages.id = notes.page_id
        WHERE notes.deleted_at IS NULL AND pages.deleted_at IS NULL;
      INSERT INTO search_index (entity_type, entity_id, notebook_id, page_id, note_id, title, content)
        SELECT 'block', blocks.id, pages.notebook_id, notes.page_id, blocks.note_id, blocks.type, blocks.data_json
        FROM blocks JOIN notes ON notes.id = blocks.note_id JOIN pages ON pages.id = notes.page_id
        WHERE blocks.deleted_at IS NULL AND notes.deleted_at IS NULL AND pages.deleted_at IS NULL;
    `
  },
  {
    version: 3,
    name: 'managed_assets_and_source_ownership',
    sql: `
      ALTER TABLE assets ADD COLUMN sha256 TEXT;
      ALTER TABLE source_documents ADD COLUMN notebook_id TEXT REFERENCES notebooks(id) ON DELETE RESTRICT;
      ALTER TABLE source_documents ADD COLUMN asset_id TEXT REFERENCES assets(id) ON DELETE RESTRICT;
      CREATE INDEX assets_notebook_idx ON assets(notebook_id, kind);
      CREATE INDEX source_documents_notebook_idx ON source_documents(notebook_id);
      CREATE TABLE asset_references (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
        block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (asset_id, block_id)
      );
      CREATE INDEX asset_references_block_idx ON asset_references(block_id);
    `
  },
  {
    version: 4,
    name: 'audio_transcription_and_export_history',
    sql: `
      CREATE TABLE transcription_runs (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
        block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        language TEXT,
        duration_ms INTEGER,
        status TEXT NOT NULL,
        confidence REAL,
        transcript_text TEXT,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX transcription_runs_block_idx ON transcription_runs(block_id, created_at DESC);
      CREATE INDEX transcription_runs_asset_idx ON transcription_runs(asset_id, created_at DESC);
      CREATE TABLE transcription_segments (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES transcription_runs(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        text TEXT NOT NULL,
        confidence REAL,
        UNIQUE(run_id, position)
      );
      CREATE TABLE export_records (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE RESTRICT,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        format TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE export_asset_references (
        export_id TEXT NOT NULL REFERENCES export_records(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
        PRIMARY KEY(export_id, asset_id)
      );
    `
  }
  ,{
    version: 5,
    name: 'persistent_jobs_and_private_diagnostics',
    sql: `
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        result_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        retry_of TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX jobs_status_created_idx ON jobs(status, created_at);
      CREATE TABLE diagnostic_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        outcome TEXT NOT NULL,
        code TEXT,
        message TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX diagnostic_events_created_idx ON diagnostic_events(created_at DESC);
    `
  }
  ,{
    version: 6,
    name: 'managed_asset_thumbnail_cache',
    sql: `
      CREATE TABLE asset_thumbnails (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        source_sha256 TEXT NOT NULL,
        cache_version INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (asset_id, source_sha256, cache_version, width, height)
      );
      CREATE INDEX asset_thumbnails_asset_idx ON asset_thumbnails(asset_id);
    `
  }
]

export function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  const applied = new Set(
    database.prepare('SELECT version FROM schema_migrations').all().map((row) => (row as { version: number }).version)
  )

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue

    database.transaction(() => {
      database.exec(migration.sql)
      database
        .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, new Date().toISOString())
    })()
  }
}
