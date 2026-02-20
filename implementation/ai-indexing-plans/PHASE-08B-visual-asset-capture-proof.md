# Phase 08B - Visual Asset Capture Proof

## Canonical Status
- This is the single canonical file for this phase.
- Consolidated on 2026-02-20 from split planning plus improvement docs.
- Includes implemented status and remaining work from merged sources.
- Keep all unfinished items active until code plus GUI proof confirms completion.

## Merged Source Files
- PHASE-08B-visual-asset-capture-proof.md
- PHASE-08B-IMPROVMENT.md

## Full Merged Spec

### Source: PHASE-08B-visual-asset-capture-proof.md

> Original header: Deep Spec Harvester - Phase 08B - Visual Asset Capture + GUI Proof


## Goal
Add a dedicated visual capture phase that stores page screenshots and product images per source, then exposes them to extraction/review with hash-backed lineage and live GUI proof.

## Why Phase 08B
- Phase 08 focuses on extraction context + strict output contract.
- Visual capture has separate runtime cost/retry/storage concerns.
- Keeping capture separate avoids coupling OCR/extraction failures to screenshot collection failures.

## Deliverables
- Visual capture module:
  - `src/extract/visualAssetCapture.js`
- Runtime integration:
  - `src/pipeline/runProduct.js`
  - `src/indexlab/runtimeBridge.js`
- API + GUI proof:
  - `src/api/guiServer.js`
  - `tools/gui-react/src/pages/indexing/IndexingPage.tsx`
- Run artifacts:
  - `analysis/phase08b_visual_assets.json` (run + latest)

## Plugin / Library choices
- Capture: `playwright` (`page.screenshot`)
- Optional scale orchestration: `crawlee`
- Image metadata + normalization: `sharp`
- Dedupe:
  - exact: `sha256`
  - near-duplicate: `imghash` (pHash)

## Implementation

### 8B.1 Capture strategy per source
- Capture up to N assets per source (configurable):
  1. full-page screenshot
  2. viewport screenshot
  3. hero-region screenshot (selector map if available)
  4. selected product/spec-card `<img>` assets

### 8B.1A Image discovery ladder (target-first)
- Resolve image candidates in this order:
  1. DOM images under target identity container (title/model/SKU proximity)
  2. product gallery/carousel slides (active and hidden slides)
  3. structured metadata images (`json_ld.image`, `og:image`, `twitter:image`)
  4. upgraded `srcset` URLs for accepted nodes
  5. image network responses tied to accepted DOM nodes
- Persist for every candidate:
  - `candidate_source_type`
  - `dom_path` / `selector_hint`
  - `alt_text` / `nearby_text`
- This prevents floating site images (hero banners, ads, unrelated cards) from being promoted by default.

### 8B.2 Manifest + identity
Per asset emit:
- `image_asset_id`
- `source_id`, `source_packet_id`, `source_version_id`
- `source_surface` (`screenshot_capture` or image surface)
- `content_hash`, `perceptual_hash`
- `storage_uri`, size/dimensions, capture timestamp

### 8B.2A LLM derivative policy (token/cost control)
- Persist original image for audit only.
- Generate derivatives with `sharp`:
  - `review_lg`: max side `1600`, `webp`, quality `75`
  - `review_sm`: max side `768`, `webp`, quality `65`
  - `region_crop`: max side `1024`, `webp`, quality `70` (if region exists)
- LLM calls must use derivative URIs only (`send_original_to_llm=false`).
- Hard cap per image sent to LLM: `<= 512000` bytes.
- Track byte savings:
  - `original_bytes`
  - `llm_variant_bytes`
  - `saved_bytes`, `saved_percent`

### 8B.2B Visual quality gate (trash-image prevention)
- Compute per-image quality checks before LLM eligibility:
  - dimensions, blur, entropy, OCR-text density, cue density
- Reject/holdout images that fail thresholds:
  - blank/low-entropy screenshots
  - heavy blur
  - UI-only captures with no product/variant cues
- Persist:
  - `quality_score`
  - `quality_gate_passed`
  - `reject_reasons[]`
- Only quality-passed derivatives are attachable to extraction context.

### 8B.2C Multi-product target gate
- Assign `page_product_cluster_id` to each image and region.
- Compute per-asset `target_match_score` and `target_match_passed`.
- Only assets that pass both:
  - `quality_gate_passed=true`
  - `target_match_passed=true`
  are eligible for extraction/review payloads.
- Persist `identity_reject_reason` for non-target assets (for example `related_product`, `carousel_other_sku`).
- Target score features:
  - brand/model/variant token overlap in `alt_text`, captions, nearby DOM text
  - DOM distance to canonical identity block
  - negative intent cues (`related`, `recommended`, `compare`, accessory bundles)
  - carousel state (`active`, `clone`, `offscreen`) and sibling SKU conflicts

### 8B.3 Extraction wiring
- Phase 08 extraction context can consume:
  - `image_asset_id`
  - optional `region_id`
  - hash metadata
- Use visual evidence mainly when:
  - identity/model/variant ambiguity is medium/high/critical
  - text evidence conflicts across sources

### 8B.4 GUI proof (required)
Add `Visual Assets (Phase 08B)` panel in IndexLab with:
- live asset count and bytes
- active source thumbnail strip
- click-to-open preview modal
- per-asset download action
- source + hash + surface metadata row
- original vs LLM-variant byte sizes + savings %
- quality gate badge + reject reason chips
- field link chips (`field_key -> image_asset_id`)

Proof steps:
1. Start run.
2. Observe new assets appear live.
3. Open preview for a source image.
4. Download the image from GUI.
5. Open a field with ambiguity and verify linked image refs are shown.

### 8B.5 Runtime events
Emit and forward:
- `visual_asset_captured`
- `visual_asset_deduped`
- `visual_region_detected`
- `extraction_visual_ref_attached`

Each event includes:
- `run_id`, `product_id`, `source_id`
- `image_asset_id`, `storage_uri`
- `content_hash`, `perceptual_hash`
- optional `field_key`
- `original_bytes`, `llm_variant_bytes`, `llm_variant`

## Config knobs
- `VISUAL_ASSET_CAPTURE_ENABLED=true`
- `VISUAL_ASSET_CAPTURE_MAX_PER_SOURCE=5`
- `VISUAL_ASSET_STORE_ORIGINAL=true`
- `VISUAL_ASSET_RETENTION_DAYS=30`
- `VISUAL_ASSET_PHASH_ENABLED=true`
- `VISUAL_ASSET_REVIEW_FORMAT=webp`
- `VISUAL_ASSET_REVIEW_LG_MAX_SIDE=1600`
- `VISUAL_ASSET_REVIEW_SM_MAX_SIDE=768`
- `VISUAL_ASSET_REVIEW_LG_QUALITY=75`
- `VISUAL_ASSET_REVIEW_SM_QUALITY=65`
- `VISUAL_ASSET_LLM_MAX_BYTES=512000`
- `VISUAL_ASSET_HERO_SELECTOR_MAP_JSON` (optional)

## Exit criteria
- At least 1 visual asset captured for image-capable sources.
- Deterministic `image_asset_id`/hash behavior on unchanged pages.
- GUI can preview + download assets during active run.
- Extraction context can attach visual refs for ambiguous fields.

### Source: PHASE-08B-IMPROVMENT.md

> Original header: PHASE-08B IMPROVMENT


## What I'd Add
1. Add deterministic image asset IDs and hash lineage for every captured screenshot/image.
2. Add pHash clustering to collapse near-duplicate visual assets across sources.
3. Add visual-to-field linking so ambiguous fields can show direct image proof.
4. Add live GUI preview + download controls for every visual asset.
5. Add multi-product target-match gate for every captured visual asset.

## What We Should Implement Now
1. Add visual capture events and run artifact output (`phase08b_visual_assets.json`).
2. Add GUI panel for live thumbnails, metadata, and download action.
3. Attach `image_asset_id` refs into Phase 08 extraction context for ambiguous fields.
4. Keep textual evidence mandatory while visual evidence boosts confidence/identity checks.
5. Require `quality_gate_passed=true` AND `target_match_passed=true` before visual refs are attachable.

## Definition Of Done
1. Each captured image has stable `image_asset_id`, `content_hash`, `storage_uri`.
2. GUI can preview and download per-source images while run is active.
3. Ambiguous identity/model fields can show linked visual refs in extraction context.
4. Multi-product pages only attach target-passed images for the active item.

