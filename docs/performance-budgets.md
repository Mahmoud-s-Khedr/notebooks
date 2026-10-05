# Renderer performance measurements and budgets

App 0.1.0, 5 October 2026, Linux desktop, AMD Ryzen 5 PRO 5650U. Five samples per scenario; tables show medians **before → after**. The saved pre-change compiled app and final reliability build ran sequentially on the same machine using the same runner and disposable fixture profiles. No build, tests or capture ran concurrently. Raw samples and build fingerprints are in [baseline](performance-before.json), [final](performance-after.json) and [comparison](performance-comparison.json).

The budget is a maximum 25% increase per comparable metric; a zero baseline becoming positive is flagged. **The final comparison has no over-budget metrics.** These are development measurements, not cross-platform latency guarantees. Large single notes still require substantial rendering work.

## Fixtures and timing

The runner executes a 4,000-text-block note; 200 notes with eight blocks each across four cursor batches; 150 notes with 50 images, 50 WAVs and 50 PDF attachments; and 100 notes with 30 searchable text blocks each. It tests actual assets, IPC reads, UI rendering, scrolling and synthetic recording. Existing disposable fixtures are normalized to remove prior recorded audio before sampling.

Workspace, pagination and search are renderer-to-IPC round trips. UI load measures selecting the fixture through first note render and an animation frame. Scroll/recording responsiveness is the median of each run’s 95th-percentile interval across 20 scrolling animation frames. Heap is V8 used heap at that point, not process RSS; collection timing and accumulated reloads affect it. Long tasks are browser PerformanceObserver entries during the sample, with count and total duration. IPC counts are instrumented invoke calls, including asset/readiness requests; they omit one-way lifecycle notifications. Search is a direct service round trip; the UI’s intentional 150 ms debounce is verified separately.

| Fixture         | Workspace ms |      UI load ms | Pagination ms |   Search ms | Scroll frame P95 ms |
| --------------- | -----------: | --------------: | ------------: | ----------: | ------------------: |
| large-page      |  35.6 → 40.4 | 2395.0 → 2434.0 |             — | 16.6 → 11.8 |         44.2 → 46.4 |
| paginated-notes |    4.7 → 4.6 |   310.0 → 310.0 |     4.6 → 4.3 |  10.0 → 9.3 |         20.5 → 20.2 |
| mixed-assets    |   11.8 → 3.3 |   258.0 → 231.0 |     6.7 → 2.5 | 10.2 → 10.1 |         20.1 → 22.7 |
| active-search   |  14.3 → 14.0 |   943.0 → 996.0 |   14.8 → 13.9 | 10.1 → 11.7 |         19.3 → 22.2 |

| Fixture         |   V8 heap MiB | Long tasks | Long-task total ms |   IPC calls |
| --------------- | ------------: | ---------: | -----------------: | ----------: |
| large-page      | 350.6 → 355.5 |  1.0 → 1.0 |    1310.0 → 1398.0 |   3.0 → 3.0 |
| paginated-notes | 623.1 → 631.0 |  1.0 → 1.0 |      144.0 → 145.0 |   4.0 → 4.0 |
| mixed-assets    | 678.5 → 686.4 |  1.0 → 1.0 |        83.0 → 78.0 | 71.0 → 50.0 |
| active-search   | 838.8 → 852.5 |  1.0 → 1.0 |      487.0 → 521.0 |   4.0 → 4.0 |

## PDF and recording

The one-page PDF fixture is opened in Research mode. Zoom alternates out/in, after normalizing below the old 210% ceiling so both builds render comparable canvas areas. The recorded starting zoom is in each JSON. Resize alternates 1100/1440 pixels at 900 pixels high; the metric includes harness IPC-to-next-frame time and explicit zoom stays fixed. Recording uses Electron’s fake device, then saves a real WAV attachment. It does not verify hardware latency, audible speech or Windows.

| Interaction         | Before ms | After ms | Change |
| ------------------- | --------: | -------: | -----: |
| pdfZoomMs           |     108.0 |    105.0 |  -2.8% |
| resizeMs            |      96.0 |    100.0 |  +4.2% |
| recordingFrameP95Ms |      18.8 |     18.4 |  -2.1% |
| recordingSaveMs     |     299.0 |    313.0 |  +4.7% |

## Regression investigation

An earlier comparison flagged resize at 96→141 ms (+46.9%). A separate five-sample CDP investigation measured style recalculation at 25.095→49.679 ms, while layout and JavaScript did not increase. The renderer imported the entire PDF.js viewer stylesheet, including unused annotation/editor rules and inherited root variables. Importing only its licensed, version-attributed core text-layer rules reduced the built CSS from 248.37 KB to 29.95 KB. Real mouse text selection, region capture and minimum-window controls passed again. The final measurements clear the budget. Intermediate samples, diagnostic deltas and the final diagnostic are retained in [performance-investigation.json](performance-investigation.json).

The original zoom handler could also shrink fitted small PDFs when Zoom in hit its hard ceiling. Comparable zoom normalization was added to the runner rather than treating different canvas sizes as equivalent. This inference from the handlers and the original measurements is preserved in the investigation record. No samples were silently discarded.

## Repeat the comparison

Install the scoped guide dependencies as described in [guide-maintenance.md](guide-maintenance.md), build the app, then run `npm run benchmark:scenarios`. The runner creates and deletes an isolated profile by default. Save a baseline compiled build first, set `PERF_APP_ROOT` to it and `PERF_OUTPUT` to its report, then run the candidate sequentially. Optional `PERF_LIBRARY_ROOT` reuses only a disposable temporary benchmark profile. Run `npm run benchmark:compare` to write the 25% report. `scripts/perf-resize-investigation.mjs` can profile existing disposable fixtures with CDP; supply the profile, app root and output path through the same environment variables.

Platform limits: Linux development Electron only; no Windows, packaged cold-start, real microphone, real Whisper runtime or paid cloud measurements. Browser scheduling, garbage collection, background host load and internal Electron instrumentation limit repeatability. These results support the measured fixtures only.
