# Research Notebook

A local-first Electron, React, and TypeScript application for capturing source material, adding reasoning, and exporting structured knowledge.

## Current vertical slice

The application currently supports a real, restart-safe flow:

1. Create a notebook and page.
2. Create notes on a page.
3. Add, edit, convert, duplicate, link, and reorder semantic text blocks (text, source text, commentary, explanation, question, answer, and quote).
4. Search local titles and active text blocks, and load long pages 50 notes at a time.
5. Rename content or move notebooks, pages, notes, and blocks to recoverable Trash.
6. Persist everything locally in SQLite and restore it after reopening.

Run it with `npm install` followed by `npm run dev`.

## Tester manual

Read the illustrated [Markdown manual](docs/user-guide.md), open the self-contained [HTML guide](docs/user-guide.html), or print the [PDF guide](docs/user-guide.pdf). The guide covers the current 0.1.0 desktop UI and identifies features that need a runtime, credential, or platform-specific verification.

The [coverage checklist](docs/guide-coverage.md) records exercised workflows and remaining checks. [Capture and build instructions](docs/guide-maintenance.md) explain how to update the screenshots and regenerate both shareable formats.

## October reliability repairs

Media exports, scoped v1 imports, complete graph duplication and source captures
now have regression coverage. Source navigation/capture controls are consolidated;
recording stays with its original note across focus changes; transcripts have a
separate review editor. Maintenance exposes age-based cleanup previews, and
exports report job completion. IPC validates the owning window and main frame.
Model downloads stream to disk, and new provider credentials use OS-backed
encryption or session-only storage.

See [repair evidence](docs/repair-evidence.md) and [extraction/transcription options](docs/extraction-and-transcription-options.md).
OCR and VAD are documented future work. Native Windows, physical microphones and
packaged sidecars require the platform checks recorded in the evidence file.

## Technical assessment and direction

### Architecture

Electron's main process owns the database and future filesystem, asset, export, and transcription work. The React renderer is restricted to presentation and calls a narrow preload bridge. Domain types are shared, but the renderer has no direct Node, SQLite, or arbitrary IPC access.

The next major boundaries should remain small services: `NotebookService`, `SourceService`, `AssetService`, `ExportService`, `TranscriptionService`, `SearchService`, and `SettingsService`. Expensive PDF, thumbnail, export, and local-transcription jobs should move to dedicated workers when implemented.

### Data model

`notebooks → pages → notes → blocks` is represented by foreign-keyed, ordered tables. Every entity has a UUID and timestamps. Blocks keep their type, JSON data, JSON metadata, and per-note position, making new block types additive rather than schema-breaking.

The migration catalogue also establishes separate `source_documents`, `block_sources`, `block_relations`, and `assets` tables. These support provenance, relationships and managed assets, preventing provenance, relationships, and files from becoming ad-hoc text conventions later.

### SQLite and data safety

The database lives in Electron's per-user application-data directory as `database.sqlite`. SQLite foreign keys, WAL mode, normal synchronous writes, a busy timeout, ordered unique constraints, and transactional multi-step mutations are enabled. Migrations are recorded in `schema_migrations` and run transactionally.

Notebook, page, note, and block deletion is recoverable: a deletion operation moves the active descendants together into Trash. Restoring that operation leaves items deleted in an earlier, independent operation untouched. Emptying Trash and permanent deletion are explicit actions. Physical asset cleanup remains deferred until the asset milestone, and backups/lossless export should precede any destructive asset UI.

## Production and nightly desktop packages

`npm run package:linux` builds **Research Notebook Production** from a stable version and creates x64 AppImage, DEB, and RPM packages. `npm run package:win` creates x64 NSIS and portable EXE packages on Windows. GitHub Actions validates pull requests and branch pushes, and successful `main` pushes replace the five stable assets on the rolling `nightly` prerelease.

Production uses the `research-notebook-production` package, executable, desktop identity, and data directory. Nightly versions (`0.1.0-nightly.N`) retain the legacy `research-notebook` package identity and show as **Research Notebook Nightly**. Both channels use the notebook logo and can be installed alongside one another, including older nightly installations. Production starts with a separate library; use the app's backup and restore tools if you want to transfer existing notes.

The initial desktop packages are unsigned. Linux and Windows will show platform trust warnings; signing and auto-update are intentionally deferred to a secrets-managed release-hardening milestone.

### Assets

The application icon source is `resources/logo.png`; Linux packages use the standard PNG sizes in `resources/icons/`, and Windows packages use `resources/icon.ico`. Regenerate those icon assets from the logo when updating the branding.

Assets should live beside the database, under managed `assets/images`, `assets/screenshots`, `assets/audio`, and `assets/files` directories. The database must store application-relative paths, MIME type, byte size, source filename, checksum when practical, and metadata—not blobs or absolute paths. Writes should use a temporary file plus atomic rename; deletion should be deferred until no block/export references remain.

### IPC and security

`contextIsolation` is enabled, renderer Node integration is disabled, sandboxing is enabled, and new windows/navigation are denied. The preload bridge exposes only explicit notebook/page/note/block methods. IPC inputs are strict Zod schemas; it does not expose filesystem paths, shell execution, or generic invoke methods.

### Block, source, and provenance model

The block type union already covers the planned initial types. Future blocks use typed data payloads while retaining generic metadata. `block_relations` represents links such as `responds_to` or `explains` without special-case tables. `block_sources` structurally records source document, selection type, PDF and printed page, bounds, and extracted text, allowing the PDF viewer to navigate to the original source and physical/printed page.

### Export and STT direction

Exports should be independent renderers over one canonical notebook read model: readable Markdown plus copied assets, versioned lossless JSON plus assets and source map, and AI-context Markdown with explicit semantic labels. A PDF exporter can follow once print layout requirements are concrete.

`TranscriptionService` should depend on a `TranscriptionProvider` interface. Local Whisper and cloud providers both return a provider-neutral transcript with segments, model, language, confidence, and timestamps. Audio remains an asset referenced by an audio block; transcripts are derived data, never a replacement for the recording. Secret provider credentials belong in OS-backed secure storage and never in exports.

### Recommended sequence

1. Complete hierarchy editing and safe deletion, then add local search over textual content.
2. Add managed assets and image/screenshot blocks.
3. Add a `SourceViewer` abstraction and a PDF implementation with text and rectangle capture into `block_sources`.
4. Add audio recording, asset persistence, and provider-neutral transcription; implement local Whisper first, then an opt-in cloud provider.
5. Add Markdown, lossless JSON, and AI-context exports with tests; add import after the lossless format stabilizes.
6. Introduce background jobs, source navigation, indexing, and PDF export as documents become larger.

## Verification

`npm test` verifies that a real SQLite file survives a close/reopen cycle and that block reordering is atomic. The pre/post test hooks switch the native SQLite module to Node's ABI for Vitest and back to Electron's ABI for the desktop app.

### Save, navigation and migration boundaries

The renderer’s application-owned `SaveCoordinator` waits for dirty editor fields and a single recording save before page/note/mode transitions or closure. Recordings retain their original destination and WAV after failure; Retry save reuses a correlated operation ID. The service commits the asset/block/reference graph transactionally and deduplicates retries using existing block metadata, without a schema or archive-format change.

Normal close/quit/restart uses narrowly typed preload messages and a main-process request ID. Main validates the sender and frame, waits for a successful renderer save, then cancels/drains background writes before closing SQLite. A failed save cancels closure. Forced process termination remains outside recovery support.

Library moves establish a service write barrier before queueing. Outstanding jobs must finish or be cancelled first. Copying and pending-restart states reject content/settings/import/new-job mutations. Restart validates and activates the bootstrap destination; original removal checks the authoritative pointer again. The persistent banner explains the restriction and offers Restart now.

PDF Text/Region modes use PDF.js’s text layer and page-scoped extraction cache. Explicit source-navigation state carries provenance from Write into Research. Workspace request correlation preserves loaded batches/selection and ignores stale results. Attachments load near the viewport; images request cached previews and offer Load original image.

### Regression and performance verification

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build`. After installing the scoped guide dependencies, run `node scripts/guide/reliability.mjs` for isolated Linux Electron workflows and `npm run benchmark:scenarios` for five-run medians. See [issue resolutions](docs/issue-resolutions.md), [workflow verification](docs/workflow-verification.json), and [performance budgets/results](docs/performance-budgets.md). The [editable guide](docs/user-guide.md), [offline HTML](docs/user-guide.html), and [printable PDF](docs/user-guide.pdf) share one source; original captures and overlays remain versioned.
