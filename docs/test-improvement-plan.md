# Test-improvement plan

The existing suite is a solid persistence foundation, but it needs a deliberate
expansion from selected main-process integration tests into a desktop-app test
pyramid. The IPC registrar and `ResearchNotebookApi` currently define 67
endpoints, while the present tests cover only a small subset. A previous Phase
3 brief called this a 54-channel contract; that count excludes 13 still-public
APIs, so the 67-entry inventory is the canonical current contract until those
APIs are intentionally changed.

## Goals and success criteria

- Make test coverage measurable and visible in CI without using a misleading
  global threshold.
- Protect data safety and recovery paths before increasing UI test volume.
- Verify every IPC contract rejects malformed input, and verify important
  endpoint dispatch behavior.
- Cover core renderer workflows and one real Electron persistence flow.
- Turn documented performance scenarios into repeatable measurements.

When complete, every pull request must pass unit/integration, renderer,
coverage, lint/format, type-check, build, and a Linux Electron smoke flow.

## Delivery phases

| Phase | Deliverable | Exit criteria |
| --- | --- | --- |
| 1. Test foundation | Vitest projects/config, coverage, lint/format scripts | `test:coverage`, `lint`, and `format:check` run locally and in CI. |
| 2. Data-safety tests | Migration, import/export, trash, library-move, and transcription test suites | Destructive and recovery paths have success and failure coverage. |
| 3. IPC contracts | Table-driven validation and dispatch tests for all 67 channels | Every endpoint rejects invalid/unknown fields; critical endpoints prove dispatch and dialog cancellation. |
| 4. Renderer tests | Testing Library and jsdom component/flow tests | Core notebook, editor, source, and error UX is tested accessibly. |
| 5. Electron E2E | Small Playwright Electron smoke suite | Create/edit/reorder/restart/persistence passes on Linux CI. |
| 6. Performance | Executable scenarios, baselines, and artifact reports | Regressions are visible, then gated on a stable runner. |

## 1. Establish the test foundation

Add these development dependencies:

- `@vitest/coverage-v8`
- `@testing-library/react`, `@testing-library/user-event`,
  `@testing-library/jest-dom`, and `jsdom`
- ESLint, TypeScript/React ESLint support, and Prettier
- Playwright when the project reaches the E2E phase

Create a Vitest workspace with isolated projects:

- **main:** Node environment for SQLite/service integration tests.
- **preload:** Node environment with Electron mocks.
- **renderer:** jsdom environment with Testing Library setup.

Add `test:main`, `test:renderer`, `test:coverage`, `lint`, and
`format:check` scripts. Keep the current `better-sqlite3` rebuild hooks around
Node-side tests.

Publish LCOV plus a concise coverage summary in CI. Start by recording the
baseline and ratcheting it. Once established, enforce branch-focused thresholds
for critical main-process code:

- database migrations and database initialization;
- notebook, export, transcription, and job services;
- IPC registration; and
- preload API contracts.

## 2. Cover data safety and recovery first

Use real SQLite and temporary, per-test library directories. Mock only
subprocesses, dialogs, network calls, and renderer-dependent APIs.

### Migrations and database

- Fresh database creation.
- Upgrade from each historical schema version to the current version.
- Reopen/idempotence behavior.
- Transaction rollback when a migration fails.
- Expected tables, indexes, and foreign-key behavior after upgrade.

### Export, import, and backup

- Lossless round trips with hierarchy, relations, transcription, and assets.
- Corrupt JSON, unsupported versions, duplicate IDs, and invalid ordering.
- Missing files, checksum mismatch, unsafe absolute paths, `..` traversal, and
  backslash paths.
- Destination collisions and cleanup of every failed export staging directory.
- Backup integrity mismatch and safe recovery instructions.

### Deletion and library migration

- Nested deletion, restore with the matching deletion operation ID, and stale
  operation-ID rejection.
- Permanent deletion, empty trash, and asset-reference preservation/cleanup.
- Interrupted library move, invalid bootstrap pointer, restart after a complete
  move, and safe old-library removal.

### Transcription, PDF, and thumbnails

- Completed, failed, cancelled, retried, and restart-recovered transcription.
- Child-process termination on cancellation.
- Proof that tokens and audio contents do not enter diagnostics or errors.
- PDF/thumbnail unsupported input, errors, cache hits/misses, and sanitized
  fallback behavior.

## 3. Systematize IPC contract coverage

Refactor endpoint declarations into a testable inventory containing channel,
input schema, dialog requirement, and handler. The registration function should
consume that same inventory so tests cannot drift from the application.

For every endpoint, table-driven tests must:

- verify registration under the expected channel;
- reject `null`, malformed values, and unknown object fields; and
- record validation failures without leaking unsafe input.

For high-risk endpoints, add behavioral tests for CRUD, reorder, trash,
import/export, backup, source capture, transcription, model operations, library
migration, and diagnostics. Verify service method arguments, dialog cancellation
behavior (`null` versus an intentional cancellation error), and service failure
logging.

## 4. Test renderer workflows

Use a typed mock of `window.researchNotebook` and test interactions rather than
large snapshots.

Priorities:

- Create, select, and rename notebooks, pages, notes, and blocks.
- Edit and reorder blocks.
- Loading, empty, and service-error states.
- Source capture actions and their disabled/error states.
- Error-boundary recovery and diagnostic reporting.
- Accessible names, keyboard behavior, focus handling, and dialog semantics.

Start with `App`, `PageWorkspace`, `SourceWorkspace`, shared UI components, and
the error boundary.

## 5. Add a small Electron end-to-end suite

Use Playwright's Electron support. Build the application and launch its compiled
main process with a unique temporary user-data directory per test.

Implement these flows in order:

1. Launch, create a notebook/page/note, edit text, and reorder blocks.
2. Quit and relaunch, then verify hierarchy and ordering persisted.
3. Export a notebook, import it into a fresh library, and verify content/assets.
4. Exercise a permission or error path, such as a cancelled dialog or an
   unavailable transcription/model state.

Run the smoke suite on Linux under `xvfb` initially. Retain Playwright traces,
screenshots, and main-process logs only for failures. Add Windows E2E only after
the Linux suite is stable.

## 6. Make performance scenarios executable

Extend the existing scenario manifest into a benchmark harness that:

- generates its fixtures in a temporary library;
- drives the Electron app through large-page, paginated-notes, mixed-assets,
  and active-search scenarios;
- collects five samples for workspace load, cursor paging, search, and input
  responsiveness; and
- records medians in JSON and uploads a comparison report as a CI artifact.

Initially report regressions without failing GitHub-hosted CI because runner
variance can create false failures. Enforce the documented 25% threshold only
on a controlled/self-hosted runner, or after a repeat-confirmation policy is in
place.

## CI rollout

Update CI in this order:

1. Run tests, publish coverage, type-check, lint, format check, and build.
2. Run the Linux Electron smoke E2E suite after the production build.
3. Keep native packaging dependent on successful validation and E2E.
4. Upload performance reports as non-blocking artifacts, then promote stable
   regressions to required checks.
