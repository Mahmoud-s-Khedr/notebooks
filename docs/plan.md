# Research Notebook implementation plan

This plan follows the core workflow: **read → capture → think → explain → structure → export → reuse**. The local notebook remains the canonical knowledge store; generated educational materials are downstream outputs.

Status legend: `[x]` completed, `[ ]` planned.

## Foundation — completed

- [x] Bootstrap Electron + React + TypeScript application shell.
- [x] Keep privileged work in Electron main process; use a React-only renderer.
- [x] Enable Electron security defaults needed for this application: context isolation, sandboxing, disabled renderer Node integration, navigation denial, and denied new windows.
- [x] Provide a narrow preload API instead of exposing generic IPC, filesystem, or shell access.
- [x] Validate all current IPC inputs with strict Zod schemas.
- [x] Create versioned SQLite migrations and enable foreign keys, WAL mode, busy timeout, and transactional writes.
- [x] Model `Notebook → Page → Note → Block` with UUIDs, timestamps, and deterministic per-parent ordering.
- [x] Implement notebook/page/note/text-block creation.
- [x] Implement note and text-block editing.
- [x] Implement transaction-safe text-block reorder.
- [x] Restore notebook hierarchy and block order after closing and reopening the SQLite database.
- [x] Add automated tests for persistence, block ordering, and invalid reorder rejection.
- [x] Add a basic three-pane workspace: notebook navigation, future source-viewer placeholder, and block editor.

## Domain model established for later use

- [x] Define the extensible initial block-type union: text, source text, commentary, explanation, question, answer, quote, image, screenshot, audio, transcript, code, table, divider, and file.
- [x] Reserve structured database tables for source documents, block provenance, generic block relationships, and assets.
- [x] Keep block content and metadata as separate JSON payloads so block types can evolve without schema churn.
- [x] Model provenance structurally rather than as text inserted into a block body.

## 1. Core notebook usability

- [x] Rename notebooks and pages.
- [x] Add safe deletion for notebooks, pages, notes, and blocks, with confirmation and recoverable trash semantics.
- [x] Add note and block duplication.
- [x] Support the text-based initial block types in the editor: source text, commentary, explanation, question, answer, and quote.
- [x] Support conversion among text-based semantic blocks.
- [x] Add generic block relationships, including Question → Answer and Source Text → Explanation.
- [x] Add centralized commands and cross-platform keyboard shortcuts.
- [x] Add local textual search across active notebook/page/note titles and text-bearing blocks.
- [x] Add cursor pagination for large page views (50 notes at a time).

## 1.1 Desktop packaging and nightly delivery

- [x] Configure Electron Builder for x64 Linux AppImage, DEB, and RPM packages plus Windows NSIS and portable EXE packages.
- [x] Package the native SQLite dependency outside ASAR and rebuild it for Electron's ABI.
- [x] Add GitHub Actions validation for pull requests and every branch push using Node 22, tests, type checks, production builds, and native packages.
- [x] Upload versioned package artifacts from native Linux and Windows runners and verify their package metadata.
- [x] Publish successful `main` builds to a rolling unsigned `nightly` GitHub prerelease with stable asset names.
- [x] Document unsigned-package platform trust warnings; signing, credentials, and auto-update remain deferred.

## 2. Managed assets

- [x] Create per-application asset folders: `assets/images`, `assets/screenshots`, `assets/audio`, and `assets/files`.
- [x] Store application-relative paths, content metadata, and file identity in SQLite; do not store large assets as blobs.
- [x] Use temporary writes plus atomic rename for imported/captured assets.
- [x] Add image, screenshot, and file blocks.
- [x] Prevent accidental asset deletion by checking block references before cleanup; export references will be added with exports.
- [x] Add asset repair/diagnostics for missing files and orphan detection.

## 3. Source viewer and provenance

- [x] Introduce a source-agnostic `SourceViewer` interface.
- [x] Implement a PDF source viewer as the first source type.
- [x] Import and manage local source documents.
- [x] Capture selected PDF text into `source_text` blocks with document ID, PDF page, optional printed page, selection type, and extracted text.
- [x] Capture rectangular PDF regions as screenshot blocks with page and bounding-box provenance.
- [x] Add “Create Q&A Note” from source selections.
- [x] Navigate from a source-linked block back to the originating document location.

## 4. Audio and transcription

- [x] Add local 16 kHz mono WAV recording and audio-block asset persistence.
- [x] Store duration, transcript runs, provider, model, language, timestamps, status, confidence, and ordered segments without discarding the original recording.
- [x] Define `TranscriptionProvider` and `TranscriptionService` interfaces.
- [x] Implement a local Whisper-based provider with Arabic (including Egyptian Arabic) and English support.
- [x] Add an opt-in OpenRouter transcription provider behind the same interface.
- [x] Store the OpenRouter key in an owner-only app-data configuration file; it is excluded from SQLite, IPC reads, logs, exports, manifests, and backups. OS-keychain storage remains deferred by the approved exception.
- [x] Allow re-transcription of a retained audio asset while preserving history.

## 5. Export, backup, and import

- [x] Implement Markdown plus copied assets export for notebook, page, and note scopes.
- [x] Implement versioned lossless JSON export containing hierarchy, stable IDs, block types, ordering, metadata, provenance, relationships, asset references, and transcription metadata.
- [x] Implement semantic AI-context export with explicit labels such as `[SOURCE]`, `[EXPLANATION]`, `[QUESTION]`, and `[ANSWER]`.
- [x] Add strict lossless-v1 archive validation before import: schema/version, IDs, ordering, JSON, relations, POSIX-only relative asset paths, file existence, and SHA-256 checks.
- [x] Ensure exported asset paths are application-relative forward-slash paths and clean staging directories after failed exports.
- [ ] Add dedicated Linux- and Windows-style archive fixture coverage for validation rejection and staging cleanup.
- [x] Add user-initiated folder-chooser backup/export workflow with staged atomic export directories and export-asset cleanup protection.
- [x] Design and implement lossless import only after the export format is stable.
- [x] Add basic PDF export after content semantics and print requirements are proven.

## 6. Scale and resilience

- [x] Persist main-process export, PDF, backup, and asset-integrity jobs in SQLite, with bounded queue concurrency and restart handling for interrupted work.
- [x] Add job status, progress, cancellation, retries, actionable sanitized failure messages, and renderer Jobs controls.
- [x] Add a user-selected, atomically staged whole-library backup with a SQLite snapshot, managed assets, verified asset hashes, manifest, and recovery instructions.
- [x] Add queued full asset-integrity scans and retain missing, orphaned, and untracked diagnostics.
- [x] Add a bounded local diagnostics log and user-selected scrubbed text export; diagnostic entries exclude paths, token-like values, content, and asset bytes.
- [ ] Route local transcription through the persistent job queue and terminate the Whisper child process on cancellation.
- [ ] Generate PDF output with a hidden Electron renderer and `printToPDF` rather than the current basic PDF writer.
- [ ] Add on-demand cached image/PDF thumbnails with deferred loading and fallback presentation.
- [ ] Measure and address large-document renderer performance.

## Explicitly deferred

- [ ] Cloud sync, accounts, teams, permissions, collaboration, and SaaS backend.
- [ ] Mobile clients.
- [ ] Notion-style databases, project management, calendar, kanban, whiteboards, or a plugin marketplace.
- [ ] Automatic AI transformations, semantic search, embeddings, and LLM integration until the canonical capture/export workflow is solid.

## Reliability update — 2026-10-05

The recording/navigation/migration/PDF/control work is implemented and tracked in [issue-resolutions.md](issue-resolutions.md), which supersedes earlier UI limitations in this historical roadmap. The app has an application-owned recording/save boundary, correlated close handshake, transactional/idempotent recording attachments, authoritative move restrictions, explicit source navigation, real PDF text selection, note actions, filtering and truthful search/readiness states. No schema/archive/backup-format migration was introduced.

Run the isolated Linux Electron runner and five-sample benchmark described in [guide-maintenance.md](guide-maintenance.md). Real Windows hardware/runtime/provider checks remain separately documented; a missing prerequisite is not reported as a successful transcription.
