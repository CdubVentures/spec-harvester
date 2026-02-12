# helper_files

Use this folder to drop trusted, category-organized inputs for targeted runs and verification.

## Structure

```text
helper_files/
  <category>/
    activeFiltering.json
    field_rules.json
    hbs_tooltips<Category>.js (optional)
    <category>Data.xlsm or .xlsx
    _control_plane/
    _generated/
    _overrides/
```

## Mouse Example

```text
helper_files/
  mouse/
    activeFiltering.json
    field_rules.json
    hbs_tooltipsMouse.js
    mouseData.xlsm
    _control_plane/
    _generated/
    _overrides/
```

## What To Drop

- `activeFiltering.json`: fixed filename for product helper rows (brand/model/variant + optional URLs/keys).
- `field_rules.json`: category field contract baseline (optional if generating from studio).
- `hbs_tooltips<Category>.js`: tooltip bank for `tooltip_key` resolution (optional).
- workbook (`.xlsm`/`.xlsx`): seed data for mapping + contract drafting in the studio.

Notes:

- Generated runtime artifacts are written to `helper_files/<category>/_generated/*`.
- Runtime loads generated artifacts first when present.
