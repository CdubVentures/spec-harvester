# Structured Metadata Sidecar

FastAPI sidecar for Phase 05 structured metadata extraction using `extruct`.

## Endpoint

- `POST /extract/structured`
- Request body:
  - `url`
  - `html`
  - `content_type`
  - `max_items_per_surface`
- Response body:
  - `ok`
  - `url`
  - `html_hash`
  - `surfaces` (`json_ld`, `microdata`, `rdfa`, `microformats`, `opengraph`, `twitter`)
  - `stats` (`json_ld_count`, `microdata_count`, `rdfa_count`, `microformats_count`, `opengraph_count`, `twitter_count`)
  - `errors`

## Local Run (Windows PowerShell)

```powershell
cd tools\structured-metadata-sidecar
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8011
```

## Health Check

```powershell
curl http://127.0.0.1:8011/health
```
