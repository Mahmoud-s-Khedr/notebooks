# Remaining work

This is the working backlog after completing Phase 4 core renderer workflow tests.
It complements the fuller rationale in [test-improvement-plan.md](./test-improvement-plan.md)
and the product roadmap in [plan.md](./plan.md).

## Test program

### Renderer follow-up

Extend renderer coverage to the workflows intentionally left outside the core
notebook/editor/source increment:

- settings;
- diagnostics;
- jobs;
- trash dialogs; and
- export/import utilities.

Use the existing typed preload mock, factories, jsdom setup, and accessible
Testing Library queries. Keep native canvas/pixel fidelity as an Electron E2E
concern.

### Phase 5 — Electron E2E

Add a small Playwright Electron smoke suite. Build the app, launch the compiled
main process with a unique temporary user-data directory per test, and retain
traces, screenshots, and main-process logs only on failures.

Implement in this order:

1. Launch; create a notebook, page, and note; edit text; and reorder blocks.
2. Quit and relaunch; verify hierarchy and ordering persisted.
3. Export a notebook, import it into a fresh library, and verify content and
   assets.
4. Verify one safe failure path, such as a cancelled chooser or unavailable
   transcription/model state.

Run this on Linux with `xvfb` first. Add Windows coverage only after the Linux
smoke suite is stable.

### Phase 6 — Performance

Turn documented scenarios into an executable benchmark harness that:

- creates fixtures in a temporary library;
- drives large-page, paginated-notes, mixed-assets, and active-search flows;
- records five samples for workspace load, cursor paging, search, and input
  responsiveness; and
- emits median JSON results plus a CI artifact report.

Initially report regressions without failing hosted CI. Gate the documented 25%
regression threshold only on a controlled runner or after a repeat-confirmation
policy is established.

### CI rollout

1. Publish coverage and run test, type-check, lint, format, and build checks.
2. Run Linux Electron E2E after the production build.
3. Make packaging depend on those checks and E2E.
4. Upload performance reports as non-blocking artifacts, then promote stable
   performance regressions to required checks.

## Product backlog

- Add Linux- and Windows-style archive fixtures that prove validation rejection
  and staging-directory cleanup.
- Route local transcription through the persistent job queue and terminate the
  Whisper child process when cancelled.
- Replace the basic PDF writer with hidden-renderer Electron `printToPDF`.
- Add on-demand cached image/PDF thumbnails with deferred loading and fallback
  presentation.
- Measure and improve large-document renderer performance.

## Explicitly deferred

These are not near-term commitments:

- cloud sync, accounts, teams, permissions, collaboration, and a SaaS backend;
- mobile clients;
- Notion-style databases, project management, calendars, kanban, whiteboards,
  or a plugin marketplace; and
- automatic AI transformations, semantic search, embeddings, and LLM
  integration until the canonical capture/export workflow is solid.
