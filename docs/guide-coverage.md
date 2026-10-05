# Guide coverage and verification checklist

Target: Research Notebook **0.1.0**, Linux built Electron capture, **2026-10-05**. The editable manual is [user-guide.md](user-guide.md). Figure numbers refer to that manual; screenshot IDs are in [capture-index.json](images/guide/capture-index.json).

**Status definitions:** exercised = performed against the real app with isolated data; inspected = checked against renderer/main code, without claiming runtime success; blocked = a required runtime, credential or platform was unavailable. A visible control does not establish successful completion. See [guide-maintenance.md](guide-maintenance.md) for reproduction.

| User-accessible surface                        | Instructions / annotated figures  | Verification and limits                                                                                                                        |
| ---------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| First run, Create notebook, New notebook       | §1–2, F1–2                        | Exercised; Windows/Linux package installation inspected, not executed.                                                                         |
| Notebook rename, page add/select/rename        | §2, F2                            | Exercised by UI with blur saves and page selection.                                                                                            |
| Notebook trash icon                            | §10, F2 marker 6, F36–37 recovery | Notebook cascade deletion/restoration exercised after the page-trash tests.                                                                    |
| Page actions, page delete                      | §8/10, F23, F37                   | Exercised deletion, parent restore and disposable-page permanent delete.                                                                       |
| Add note / Create first note, active selection | §2, F2, F15                       | Add note exercised; empty-note creation uses same handler. Focus behavior checked.                                                             |
| Load more notes                                | §2, F3                            | Exercised 50→51 notes; only fixture setup used existing preload bridge.                                                                        |
| Seven text block types, edit/save              | §3, F4–5                          | All seven inserted/edited by UI; no rich-text controls.                                                                                        |
| Clickable command menu, image/audio entries    | §3/5, F5, F14–17                  | Semantic insertion and attachments exercised; /audio invokes the shared recorder; empty-block slash and keyboard behavior have regressions.    |
| Duplicate, menu reorder, drag, Alt+arrows      | §3, F6–7                          | Exercised; changes persist through later app restart.                                                                                          |
| Add answer and responds-to relation            | §3, F6/8                          | Exercised; linked answer shown in inspector.                                                                                                   |
| Inspector conversion                           | §3, F8                            | Exercised text→commentary; media conversion disabled.                                                                                          |
| Four relation types, Link / Remove relation    | §3, F8                            | Link/removal exercised; all type labels inspected. Loaded-page target limit explained.                                                         |
| Metadata, sourced inspector navigation         | §3–4, F8/11                       | Metadata read-only inspected; source navigation exercised in Research.                                                                         |
| Block deletion and restoration                 | §3/10, F6/36                      | Exercised. Delete in Trash requires default-cancel confirmation (F42).                                                                         |
| Write / Research, sidebar controls, divider    | §4, F9/13                         | Exercised switches, collapse/expand and pane drag.                                                                                             |
| Import PDF, source selector                    | §4, F9                            | Two PDF imports and source switching in both directions exercised; F9a shows the actual second source.                                         |
| Physical page input, previous/next, zoom       | §4, F9–10                         | Input, navigation and zoom exercised; invalid out-of-range behavior is not advertised.                                                         |
| Printed-page reference                         | §4, F10                           | Entered during text capture; not applied to region capture.                                                                                    |
| Editable extracted text / Capture text         | §4, F10–11                        | Real selectable text layer and edited-text preservation exercised; OCR unavailable.                                                            |
| Create Q&A                                     | §4, F10–11                        | Exercised sourced question + linked blank answer in a new note.                                                                                |
| Region capture                                 | §4, F12                           | Real pointer drag and generated image captured.                                                                                                |
| View source / provenance link                  | §4, F11–12                        | Research navigation checked against source/page; Write-to-Research and cross-document provenance restoration exercised.                        |
| Attach image/screenshot/audio/file             | §5, F14/17                        | File/image/screenshot/audio imports and recording attachment exercised; actual file-download output and audible playback need a platform pass. |
| Audio playback controls                        | §5, F17                           | Player/WAV rendering exercised; audible output not verified.                                                                                   |
| Recording start/stop/meter                     | §5, F15–17                        | Exercised with synthetic input. Actual microphone permissions/mute/disconnect require manual device testing.                                   |
| Local model download/cancel/retry              | §6/9, F18–19/34                   | Download/cancel/retry exercised. A fetch failure was followed by verified Tiny and Base installations (F19a).                                  |
| Default selection/model removal                | §6, F18–19c                       | Two actual model files installed; Base→Tiny default change and confirmed Base removal exercised (F19a–19c).                                    |
| Key save/replace/remove                        | §6, F18/21/21a                    | Save, replace and confirmed removal exercised with dummy local values (F21a); no provider authentication or upload claimed.                    |
| Provider/language/Transcribe                   | §6, F17/20–21                     | Selection/request exercised. Local success blocked by absent sidecar; cloud success blocked by absent key.                                     |
| Transcript progress/result/error               | §6, F20–21/34–35                  | Actual failures and diagnostics exercised. Progress/completed transcript path inspected only.                                                  |
| Top search/results/shortcut                    | §7, F22                           | Actual prefix search and result click exercised. Filtering and truthful search states have renderer regression coverage.                       |
| All export formats / three scopes              | §8, F23–24                        | Markdown/notebook, PDF/page, lossless/notebook and AI context/active note exercised; not all 12 combinations tested.                           |
| Export assets/manifest/source inclusion        | §8, F24                           | Output folders checked by artifact verification; scope limitations inspected.                                                                  |
| Lossless import / new notebook copy            | §8, F25–26                        | Export→import→immediate first-page opening exercised.                                                                                          |
| Library backup and recovery                    | §8, F25/27–28                     | Backup job and files exercised. Separate disposable filesystem recovery check; never described as lossless import.                             |
| Appearance/density/back to workspace           | §9, F29                           | Dark/light and compact/default selections exercised; system option inspected.                                                                  |
| Library summary/move/restart                   | §9, F30–32                        | Copy verification, restart and new active path exercised.                                                                                      |
| Remove original / confirmation                 | §9, F32–33                        | Exercised in disposable library with actual confirmation accepted.                                                                             |
| Jobs Cancel/Retry/status                       | §9, F34                           | Model-job cancel and retry exercised; conditional availability explained.                                                                      |
| Maintenance backup/scan/export/jobs            | §9, F27                           | Real scan and backup; diagnostics export exercised from dialog.                                                                                |
| Diagnostics filters/details/export             | §9, F35                           | Filters, expand/full detail, scan and local export exercised with genuine errors.                                                              |
| Error alert / Dismiss                          | §9/11, F20–21                     | Actual setup failures observed; dismissal changes only alert visibility.                                                                       |
| Trash Restore/Delete/descendants               | §10, F36–37                       | Block restore, page cascade/restore, disposable-page permanent delete exercised.                                                               |
| Search / new-note / reorder shortcuts          | §11, F7/22                        | Ctrl+K, Ctrl+Shift+N and Alt+arrow exercised.                                                                                                  |
| Troubleshooting / first session / feedback     | §11–13, referenced figures        | Written against observed labels and limitations; no external feedback sent.                                                                    |

## Updated controls and regression coverage

The 2026-10-05 reliability pass adds note titles/trash actions and sidebar filtering (F38), real PDF Text/Region modes and explicit capture destination (F39), minimum-window layout (F40), retained-audio Retry save (F41), and default-cancel permanent deletion (F42), cached media/original loading (F43), and external transfer disclosure (F44). Updated originals and markers are stored under `images/guide/captures/2026-10-05-reliability/`; previous originals remain in `2026-10-05-before-fixes/`.

[workflow-verification.json](workflow-verification.json) records real Electron text selection, zoom/edit preservation, page clamping, Write-to-Research provenance, failed save/navigation recovery, window-close recording persistence, immediate lossless import, migration write rejection, destination activation, and original removal. The restart request runs the real close handshake; the harness intercepts relaunch and starts a fresh controlled Electron process. No paid cloud request was made.

Renderer regressions cover selection/batch preservation, distant new-note activation, stale page responses, filtering, import cancellation, search states/debounce, editor save order, PDF modes/page validation, microphone denial and retained WAV retries. Service tests cover migration restrictions/cancellation and atomic, idempotent recording commits. See [issue-resolutions.md](issue-resolutions.md).

Remaining product limits: metadata is read-only; there is no standalone transcript editor/history selector, cloud model selector, Empty Trash, AI search, OCR or forced-termination recording recovery. Whole-library backup recovery remains a separate filesystem procedure.

## Release sign-off checks

- [ ] Install each supplied Windows and Linux package on a clean supported machine.
- [ ] Verify real microphone permission, input level, muted/disconnected input, saved speech and audible playback.
- [x] Complete verified Tiny/Base downloads, default switching and nondefault removal.
- [ ] With the packaged sidecar, produce an accurate local transcript and observe actual progress/results.
- [ ] With explicit provider authorization, verify a real credential and cloud transcript. Local key save/replacement/removal passed using dummy values; external audio disclosure is documented.
- [x] Try a second imported PDF and switch sources; cross-document source-link return and printed-page restoration passed.
- [x] Exercise note creation shortcut and notebook cascade deletion/restoration in a disposable library.
- [ ] Exercise attached-file download and audible imported-audio playback on each platform. Imported audio attachment was exercised on Linux.
- [x] Recheck figure labels and update captures whenever the UI changes.

These remaining platform/prerequisite checks are explicit; the guide's delivered artifacts do not claim they passed.

## Delivered-artifact verification

The final guide contains **49 annotated illustrations** and a tagged A4 PDF. All captions occur in the PDF; there are no text blocks outside page bounds and rendered outer page edges are clear. Embedded screenshot originals may extend beyond their SVG crop; those regions are clipped in the rendered PDF. The HTML was opened with networking disabled: all images decoded, all contents anchors resolved, and no external image/font/script/stylesheet was needed. A 390-pixel view had no horizontal overflow. Markdown relative-file links resolved.

Exports completed for Markdown/notebook, PDF/page, lossless JSON/notebook, and AI context/active note. Export and backup asset hashes were checked; the lossless archive retained its source and relation records. A separate library backup was restored into a fresh disposable profile: 1 notebook, 2 pages, 19 blocks, 2 source links, and 2 audio blocks loaded, including their assets. This recovery did not use lossless import.

Original PNGs, separate vector overlays, annotated compositions, and capture observations are retained. Visual review included the full screenshot contact sheet and full-size PDF pages for semantic types, insertion/actions menus, PDF capture, recording start/stop, model installation/default/removal, dummy-key controls, diagnostics, exports and Trash. See [guide-verification.json](guide-verification.json) for the output checks and [capture-index.json](images/guide/capture-index.json) for the actual workflow observations. Application behavior and narrowly typed IPC were updated in the reliability pass.
