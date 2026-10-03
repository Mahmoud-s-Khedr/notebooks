# Renderer performance budgets

The benchmark scenarios are deterministic: a 4,000-block page, 200 notes split over
four cursor pages, 150 mixed image/audio/PDF attachments, and an active full-text
search over the same fixture.  Measurements are collected in five samples and compared
by median, so they are useful across different developer machines without pretending
to be fixed millisecond SLAs.

The committed baseline is the median from the reference revision on the same machine.
The budget fails when initial workspace load, cursor-page/scroll work, search, or input
responsiveness while thumbnails are loading regresses by more than 25%.  A sample is
discarded only when the browser reports a long task from an unrelated process.

The renderer keeps notes paginated, requests thumbnails only near the viewport, and
does not access files directly. Search callers should debounce input (the UI currently
searches on Enter/Find), and any new continuous search control must use a 150 ms debounce.
