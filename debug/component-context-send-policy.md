# Component Value Review Context Policy

Generated: 2026-02-17
Workbook update: `debug/source-performance-review-ai-matrix.xlsx`

## What Current Code Does
- LLM extraction is source-scoped per page/source run.
- Aggressive mode currently selects one best evidence pack, not full all-sources payload.
- Runtime component review queue includes `product_attributes` from current extracted values.
- Component AI validator receives candidate component properties + variance policies + product attributes.

## Recommended Factor-In Rule (Component + Shared Variance)
- Always send current component row all values for component fields (`sensor`, `switch`, `encoder`, `material`).
- Send full item row with selected highest-confidence source per value when:
  - required/critical/identity fields, or
  - effort >= 7, or
  - approved confirmations are below pass target, or
  - variance/constraint mismatch is detected, or
  - top candidate conflict persists after new source ingest.
- For lower-stakes component fields, keep full-row send conditional to preserve performance.

## Added Matrix Columns
- `table_linked_send (component values | component values + prime sources)`
- `list_linked_send (list values | list values prime sources)`
- Table-linked keys (component references) now explicitly mark whether they send only component values or component values plus prime sources.
- List-linked keys now explicitly mark whether they send list values only or list values plus prime sources.

## Payload Shape For Full Item Row Snapshot
For each field in the row, include:
- selected value
- confidence
- approved_confirmations / pass_target
- top evidence summary: `url`, `snippet_id`, `method`, `tier`, `source_id`

## Shared Variance In Mouse Mapping
- `sensor`: `dpi (upper_bound)`, `ips (upper_bound)`, `acceleration (upper_bound)`
- `switch`: `click_force (override_allowed)`

## Implementation Delta Needed (if you want this enforced in runtime)
- Extend component review queue payload construction to include per-field best-source snapshot, not only raw `product_attributes` values.
- Keep extraction source-scoped, but attach aggregated row snapshot from consensus provenance for component adjudication calls.
- Use full-row snapshot only on trigger conditions listed above.
