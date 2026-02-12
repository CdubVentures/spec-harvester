# Mouse Category Setup Guide

This category now runs in `Excel + field_rules + schema` mode.

## Source Of Truth

- Master workbook:
  - `helper_files/mouse/mouseData.xlsm`
- Category rules:
  - `helper_files/mouse/field_rules.json`
- Generated schema + runtime contract:
  - `helper_files/mouse/schema.json`
  - `helper_files/mouse/_compiled/mouse.spec_helpers.compiled.json`
  - `helper_files/mouse/_compiled/mouse.expectations.json`
  - optional runtime mirror files only when `CATEGORY_MIRROR_RUNTIME_FILES=true`

Identity (`brand`, `model`) comes from Excel rows configured in `field_rules.json`.
Identity fields are not kept inside schema `field_order`.

## Required Config Pattern

`helper_files/mouse/field_rules.json` controls:

- Excel extraction coordinates:
  - sheet (`dataEntry`)
  - label row range (`B9:B83`)
  - identity rows (`brand_row`, `model_row`, optional `variant_row`)
- Schema behavior:
  - `exclude_fields` (identity/editorial fields never in schema field order)
  - `include_fields` (additive extras like `edition`)
  - `preserve_existing_fields` (keep manual schema fields unless excluded)
  - `critical_fields`, `expected_sometimes_fields`
- Output normalization contract:
  - `field_contract_overrides` for enums/types/units/aliases

## Build / Refresh Commands

Sync schema and compiled contract from workbook + field rules:

```bash
node src/cli/spec.js sync-category-schema --category mouse --local
```

Train and regenerate compiled contract + expectations:

```bash
node src/cli/spec.js category-train --category mouse --training-set-size 10 --mode calibration --local
```

## Notes For `edition`

`edition` is now preserved/added even though it is outside `B9:B83` by:

- `schema.include_fields: ["edition"]`
- `schema.preserve_existing_fields: true`

If you want `edition` hard-targeted in hunts, add `fields.edition` to `required_fields` in `field_rules.json`. If `required_fields` is omitted, runtime derives hunt priorities from field rules + schema critical/expected fields and does not persist a `required_fields.json` file.

## Runtime Defaults

Defaults are set for Excel-first operation:

This keeps extraction deterministic and aligned to workbook-derived schema contracts, with Excel as the only helper data source.
