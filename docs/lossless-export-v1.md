# Lossless export v1

`notebook.lossless.v1.json` is the compatibility contract for the future import
milestone. It contains `schemaVersion: 1`, export scope and time, the stable
SQLite hierarchy IDs and positions, raw block data/metadata, source provenance,
relations, managed asset identities and forward-slash export paths, plus the
complete transcription run and segment history. Asset bytes are copied beside
the JSON in `assets/` and are never embedded in SQLite or the JSON payload.

Secrets, including an OpenRouter key, are deliberately absent from this format,
from manifests, and from all other exports. Imports validate the complete v1
archive before writing anything, including forward-slash application-relative
asset paths and SHA-256 values. An import always creates a new notebook copy:
every live ID is fresh, internal references are remapped, and exported IDs are
retained only as `importedFromId` provenance metadata. Unsupported versions,
traversal paths, missing assets, invalid JSON, and hash mismatches are rejected.

October 2026 compatibility additions use existing JSON fields, without changing
`schemaVersion: 1` or SQLite migrations. Exports normalize each selected sibling
group to contiguous positions without changing live database positions. Imports
also accept unique nonnegative positions with gaps, sort each sibling group,
and normalize it to contiguous positions. Physical containment rejects
symlink escapes; application paths use native component-aware comparisons.

An audio block's `transcriptReviews` object maps run UUIDs to `{ text, reviewedAt }`.
Recognition output and segments remain immutable. Import and duplication remap
review keys, active run IDs, block ownership and segment IDs. Copied/imported
queued or running records become cancelled history; they never start jobs.
New region `bounds_json` uses an optional `coordinateSpace` value of
`pdf-points-bottom-left`. Untagged bounds are legacy pixels, not implicitly
converted. Optional `relationshipTargets` descriptors provide readable outgoing
target context; they do not extend the in-scope imported relation graph.
