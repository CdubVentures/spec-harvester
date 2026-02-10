# helper_files

Use this folder to drop trusted, category-organized inputs for targeted runs and verification.

## Structure

```text
helper_files/
  <category>/
    models-and-schema/
    accurate-supportive-product-information/
```

## Mouse Example

```text
helper_files/
  mouse/
    models-and-schema/
    accurate-supportive-product-information/
```

## What To Drop

- `models-and-schema/activeFiltering.json`: fixed filename for target rows (brand/model/variant + optional URLs/keys).
- `accurate-supportive-product-information/*.json`: any JSON file; all files are scanned and used as supportive verification evidence.

Notes:

- Category schema in `categories/<category>/schema.json` is still canonical.
- Supportive files can include extra keys; the pipeline maps only canonical fields.
