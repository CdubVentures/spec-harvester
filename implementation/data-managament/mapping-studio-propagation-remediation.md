# Mapping Studio Propagation Remediation

Generated on: 2026-02-21

## Goal

Make Mapping Studio changes propagate predictably for:
- review grid flags,
- component tables,
- enum lists,
- and all related frontend displays after a hard refresh.

## Priority 0 (Correctness)

1. Auto-validate map before save/compile
- Add frontend call to `POST /studio/{category}/validate-map` before `PUT /workbook-map` and before compile.
- Block write/compile on validation errors, show warnings inline.

2. Compile -> automatic SpecDb resync
- After successful compile process exit (`process-completed`), run category `seed-db`.
- Return/emit success/failure telemetry for the resync phase.

3. Add stale-row reconciliation during reseed
- Extend seed path to remove stale `component_identity/component_values` and `enum_lists/list_values` rows not present in latest generated artifacts.
- Keep user overrides by explicit merge policy, not by orphan row retention.

## Priority 1 (UX Consistency)

1. Expand compile invalidation keys
- Include `studio-workbook-map` and `workbook-context` in compile-finish invalidations.

2. Add workbook-map save broadcast
- Emit `data-change` event on workbook-map save (scoped type, e.g. `workbook-map-saved`).
- Ensure AppShell invalidates context-sensitive queries for that event.

## Priority 2 (Operator Confidence)

1. Add propagation status panel in Studio
- Show explicit phases:
  - `Map saved`
  - `Compile complete`
  - `SpecDb synced`
  - `UI refreshed`

2. Add tests for propagation contract
- Integration tests:
  - map save validation,
  - compile + auto-resync,
  - stale-row cleanup,
  - expected query invalidation coverage.

