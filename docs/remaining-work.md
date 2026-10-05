# Remaining work

This is the working backlog after the October 2026 reliability and guide update.
It complements the fuller rationale in [test-improvement-plan.md](./test-improvement-plan.md)
and the product roadmap in [plan.md](./plan.md).

## Verified reliability work

The recording/migration/navigation/PDF/control fixes and their verification are tracked in [issue-resolutions.md](issue-resolutions.md). The Linux Electron runner is `scripts/guide/reliability.mjs`; the five-sample performance runner is `scripts/perf-scenarios.mjs`, with results and limitations in [performance-budgets.md](performance-budgets.md).

## External verification still required

- Windows execution and installer/package smoke checks; this environment only supplies Linux.
- Real microphone permission prompts, speech playback, hardware mute/disconnect and device latency; synthetic input verifies recording persistence and error recovery.
- Real local Whisper recognition with a supported runtime and installed model. Controlled provider fixtures verify service behavior; the development runtime is unavailable.
- Live OpenRouter recognition only under separate explicit authorization with credentials and charge approval. No cloud request was made here.
- Clean-machine package installation on each supported Linux distribution.

## Follow-up work

- Broaden settings/diagnostics/export renderer interaction tests beyond the regression and real Electron checks already supplied.
- Run the Linux Electron workflow in CI with a controlled display/Xvfb; add Windows once a runner is available.
- Publish benchmark JSON as CI artifacts and gate controlled-machine comparisons after repeated measurements are stable.
- Add transcript history/editing and additional insertion types only under a separate product scope.

## Explicitly deferred

These are not near-term commitments:

- cloud sync, accounts, teams, permissions, collaboration, and a SaaS backend;
- mobile clients;
- Notion-style databases, project management, calendars, kanban, whiteboards,
  or a plugin marketplace; and
- automatic AI transformations, semantic search, embeddings, and LLM
  integration until the canonical capture/export workflow is solid.
