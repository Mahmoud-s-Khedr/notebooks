# Updating the illustrated tester guide

The guide follows the application’s verified behavior. Its tooling launches the real built Electron application with a fresh isolated library; the reliability pass also updates application behavior and typed IPC. The app's root dependencies are unchanged. Tool dependencies are scoped to `scripts/guide` and locked separately.

## Build the shareable guide

Prerequisites: Node 22+, an installed app development environment, and Google Chrome. From the repository root:

```bash
npm ci --prefix scripts/guide
node scripts/guide/build.mjs
```

Set `GUIDE_CHROME` to another installed Chromium/Chrome executable if necessary. The build first regenerates compositions with `annotate.mjs` from original PNGs and recorded marker bounds, adding gutters so numbers do not cover labels. It then reads `docs/user-guide.md`, embeds the referenced SVG/PNG bytes as data URLs, generates anchor navigation and responsive/print CSS, opens the result with networking disabled, verifies image decoding and navigation targets, and prints the **same HTML** to `docs/user-guide.pdf`. It checks a 390px layout for horizontal overflow. The HTML contains no external image, font, script or stylesheet dependencies. Linked supplementary Markdown/PDF files are optional adjacent repository documents, not needed to render the manual.

Generated files:

- `docs/user-guide.html`: standalone HTML manual with contents, figure captions and alt text.
- `docs/user-guide.pdf`: tagged PDF with heading outline and page numbers.
- `docs/images/guide/html-preview.png`: build preview for local visual review.

Do not hand-edit generated HTML or PDF. Edit Markdown, then rebuild.

## Recapture app workflows

Prerequisites: app root dependencies installed, Electron SQLite ABI available (`npm ci` runs its rebuild), graphical Linux session, and a nonprivate PDF. This run uses synthetic audio and can download/cancel model files, create exports/backups, delete disposable content, and move/delete its isolated original library. It does not enter real credentials or make a paid cloud call.

```bash
npm run build
npm ci --prefix scripts/guide
node scripts/guide/reliability.mjs
node scripts/guide/build.mjs
```

The reliability workflow creates its own unique directory with `mkdtemp` and verifies isolation. Legacy full-capture tooling requires an **empty, task-specific absolute directory** for `GUIDE_DEMO_ROOT`. Do not point it at real application data, a home directory, or a previous capture. The script checks Electron's default user-data path is inside that directory and rejects an existing populated library on a normal full capture. It uses `XDG_CONFIG_HOME` only in the child app environment; your normal app data is untouched. This workflow was built for Linux; Windows installation/testing is separate.

The supplemental `source-switch.mjs` run uses the same demo root after capture, imports a renamed nonprivate PDF copy, exercises the source selector in both directions, and captures Figure 9a. It requires a complete main capture.

The supplemental `model-workflows.mjs` run installs Tiny and Base (about 226 MB in total before removal), selects defaults and removes Base, then saves/replaces/removes dummy local key values without invoking cloud transcription. It captures Figures 19a–19c and 21a. Downloads can fail because of network prerequisites; if they do, the script reports the actual result and you must adjust conditional guide sections instead of reusing an unobserved success state. No real credential is used.

The default PDF comes from `/home/mk/Documents`, as requested. Override it with another nonprivate PDF but update the physical/printed page and research wording in the script/manual. _Think Python_, Allen B. Downey, second edition, is the reference used here. It is not copied into the repository; screenshots contain only the displayed example page. Do not use personal PDFs or private screen captures. The included demonstration attachment images are screenshots of the empty app, and the attached text file contains invented research notes.

### How capture works

- `playwright-core` launches the installed Electron binary and clicks actual renderer controls. Screen states and persisted changes come from the real app.
- Native file pickers are routed in the capture process to known fixtures/destination folders. This substitutes file selection, not import/export/backup implementation. Native dialogs are not fabricated in screenshots. Confirmation prompts are accepted only in the isolated demo.
- Chromium supplies a synthetic audio device and bypasses real microphone consent prompts. Start/stop, meter and WAV/player controls are real; real permissions and speech recognition remain manual checks.
- The existing preload bridge seeds 51 pagination notes only. Other workflow steps use visible UI controls. No capture script is included in the app bundle.
- Raw PNGs go in `docs/images/guide/originals/`. Keep them unchanged.
- Separate transparent vector overlays go in `docs/images/guide/overlays/`. They contain high-contrast rectangles/circles and numbered markers positioned from actual control bounds.
- Composed SVGs in `docs/images/guide/` embed the corresponding original PNG plus overlay. Markdown uses those illustrations; HTML embeds the composed SVGs.
- `capture-index.json` records dimensions, control descriptions/bounds, version, timestamp, platform, synthetic-input disclosure, and observations. Keep it with the captures.

`GUIDE_RESUME=1` is a recovery aid for tooling development that skips initial notebook/block setup and resumes a previously isolated demo at Research. It is not a clean release verification run. A final guide should come from a complete successful fresh run.

### Review images before building

Open originals and compositions side by side. Check that every marker identifies the intended control and its number agrees with the caption. Keep native button labels visible. Review recording start/stop, PDF capture footer, menu text and destructive actions at full resolution. Check that no personal paths, credentials, private document content or unrelated desktop windows were captured. A focused crop is preferable to shrinking a tiny menu inside a wide screenshot.

When a prerequisite is absent, preserve the real failure and label the limitation. Do not invent an Installed model, a completed transcript or a success toast. Update `guide-coverage.md` and the guide's version/date after a new release audit.

## Verify exports and disposable recovery

After capture, run the artifact checker using the same demo root:

```bash
GUIDE_DEMO_ROOT=/tmp/research-notebook-guide-new-capture \
node scripts/guide/verify-artifacts.mjs
```

This checks actual output folders and asset hashes, opens the export PDF signature/content, and restores a library backup into **another fresh disposable profile under that demo root**. It relaunches Electron and checks notebook/pages/text from the copied database/assets. It does not overwrite the original or active relocated library, and it does not call lossless import to simulate whole-library recovery. The recovery check verifies a backup's asset manifest; that manifest does not carry a database checksum. The backup's own RECOVERY.md remains the recovery reference.

Review printable output:

```bash
pdfinfo docs/user-guide.pdf
pdftotext -layout docs/user-guide.pdf /tmp/research-notebook-guide-print.txt
pdftoppm -scale-to 1500 -png docs/user-guide.pdf /tmp/research-notebook-guide-page
```

Inspect the page thumbnails and full-size pages containing menus, recording controls, capture footer and Trash. Check captions stay with images, no figure is cut across pages, and body text/tables remain readable. The build caps figure height and avoids breaks inside figures; this complements, rather than replaces, visual inspection. Record checks in the verification section of the coverage document.

## Auditing a new version

Read `App.tsx`, `PageWorkspace.tsx`, and `SourceWorkspace.tsx` alongside the running app. Check each accessible label, menu item, settings section, conditional control and error/recovery path against the coverage table. Consult IPC/service code for actual file contents, storage, search behavior and boundary conditions. Do not describe internal bridge methods as visible features. Keep unverified prerequisites and platform checks separate from exercised workflows.

## Reliability and performance commands

`node scripts/guide/reliability.mjs` is also the Linux Electron regression runner. It preserves prior originals, records new originals with per-control marker bounds, and writes `docs/workflow-verification.json`. `annotate.mjs` reads each capture’s `originalPath` when present, then creates separate numbered vector overlays and composed figures. The earlier capture/model/source scripts remain historical tools and may need label adaptation for a new full-library capture.

Run `npm run benchmark:scenarios` after building. It uses a unique disposable library, deterministic large-page/pagination/mixed-assets/search fixtures, five samples, and fake microphone input. Set `PERF_APP_ROOT` to a saved baseline build and `PERF_OUTPUT` to the comparison JSON path. Keep machine, display settings and runner identical. Run `node scripts/perf-compare.mjs docs/performance-before.json docs/performance-after.json` for the 25% regression report. Do not equate fake-device responsiveness with real microphone or Windows verification.

After generating the guide, run `python scripts/guide/check-pdf.py` with PyMuPDF installed. It checks all captions and page bounds, updates the verification record, and exports representative pages under `/tmp/notebook-guide-pdf-review` for visual review.

For faster repeat benchmarks, `PERF_LIBRARY_ROOT` may point to a disposable `/tmp/notebook-performance-*` fixture profile retained from a prior run. The runner normalizes recording artifacts before sampling. Never point it at a research library. Run baseline and candidate sequentially, without builds, tests or captures running concurrently.
