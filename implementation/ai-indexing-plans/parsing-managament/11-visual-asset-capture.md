# 11 - Visual Asset Capture (Per Source)

## Goal
Capture and persist real page screenshots and product images per source so downstream OCR and LLM visual validation can verify model/variant identity with image evidence.

## Why Separate From Phase 08
- Phase 08 should focus on OCR extraction only.
- Visual capture has different concerns:
  - screenshot orchestration
  - image dedupe/hash
  - storage retention
  - cross-source visual matching
- Splitting capture and OCR makes retries, cost, and debugging cleaner.

## Plugin / Library Stack
- Renderer and page screenshots:
  - `playwright` (`page.screenshot`, full-page and viewport)
- Crawl orchestration (optional at scale):
  - `crawlee` (reuse dynamic fetch queue/session policies)
- Image normalization and metadata:
  - `sharp` (resize, format normalize, dimensions, byte size)
- Perceptual dedupe:
  - `imghash` (or equivalent pHash library) + `sha256` content hash
- Storage:
  - existing storage adapter path (`local/S3-compatible`) for image blobs

## LLM Image Size Policy (Required)
- Store original image once for audit/replay.
- Generate compressed derivatives for model calls:
  - `review_lg`: max side `1600`, format `webp`, quality `75`
  - `review_sm`: max side `768`, format `webp`, quality `65`
  - `region_crop`: max side `1024`, format `webp`, quality `70` (only when region exists)
- Hard caps:
  - never send original binary to LLM
  - preferred per-image payload: `80KB - 350KB`
  - hard cap per image for LLM call: `500KB`
- Keep hash lineage for all variants:
  - original `sha256`
  - derivative `sha256`
  - perceptual hash (`pHash`) for cross-source image matching

## Anti-Trash Image Gate (Required)
- Every captured asset must pass a quality gate before LLM eligibility:
  - min dimensions: `>= 320x320`
  - blur score threshold (Laplacian variance) above configured minimum
  - entropy threshold above configured minimum (reject blank/flat images)
  - text-region density threshold for OCR-relevant surfaces
  - dedupe suppression by exact hash and near-duplicate pHash distance
  - reject known UI-only surfaces (cookie modals, nav bars, footers) when no product cues found
- Emit for each asset:
  - `quality_score` (0..1)
  - `quality_gate_passed` (bool)
  - `reject_reasons[]` (if not passed)
- Only `quality_gate_passed=true` assets may be referenced in LLM extraction/review payloads.

## Target Design
- Per source URL, capture:
  1. full-page screenshot
  2. above-the-fold screenshot
  3. hero/product region screenshot (selector-driven if available)
  4. selected `<img>` product/spec-card assets
- Emit `image_asset_id` records with:
  - `content_hash` (exact dedupe)
  - `perceptual_hash` (near-duplicate dedupe)
  - `storage_uri`
  - dimensions and mime metadata
  - page context (scroll, viewport, dom anchor)

## Image Candidate Discovery Order (Required)
- Candidate sources are evaluated in this order:
  1. DOM images inside target identity container (title/model/SKU block proximity)
  2. Product gallery and carousel slides (active + non-active slides)
  3. Structured metadata images (`json_ld.image`, `og:image`, `twitter:image`)
  4. High-resolution `srcset` candidates for accepted DOM nodes
  5. Network image responses linked to accepted DOM nodes
- Persist `candidate_source_type` per image:
  - `dom_img`, `carousel_img`, `json_ld_image`, `opengraph_image`, `twitter_image`, `network_image`
- Always keep DOM linkage for audit:
  - `dom_path`, `selector_hint`, `alt_text`, `nearby_text`

## Multi-Product Identity Gate (Required)
- Build per-page product clusters for visual assets:
  - `page_product_cluster_id` assigned to each image/region
  - cluster-level `target_match_score`
  - `target_match_passed` boolean
- Only target-passed + quality-passed images are eligible for extraction/review payloads.
- Keep rejected images for audit with `identity_reject_reason`.
- Target scoring inputs should include:
  - brand/model/variant token overlap (`alt_text`, captions, nearby DOM text)
  - DOM distance to canonical identity block
  - negative cues (`related products`, `you may also like`, `accessories`, sibling SKU ids)
  - carousel position and active-slide status

## Output Contract (Extraction-First)
- Add visual records into source packet:
  - `visual_evidence.image_assets`
  - `visual_evidence.regions`
  - `visual_evidence.model_variant_cues`
- Evidence rows can reference:
  - `image_asset_id`
  - `region_id`

## Implementation Plan
1. Add `src/extract/visualAssetCapture.js` orchestration wrapper.
2. Reuse existing screenshot path (`src/extract/screenshotCapture.js`) as low-level capture utility.
3. Add hash pipeline:
  - `sha256` for binary exact dedupe
  - `pHash` for perceptual clustering
4. Add derivative pipeline with `sharp` and byte-size guardrails.
5. Persist metadata + storage URI in source packet and SQL projection payload.
6. Add domain selector overrides for hero region capture.

## Validation
- Functional:
  - at least one image asset on image-capable product pages
  - deterministic IDs/hashes for unchanged content
- Quality:
  - pHash cluster quality across duplicate sources
  - visual cue extraction quality for model text/sku text
- Performance:
  - capture latency overhead within configured budget

## Rollout
- Feature flags:
  - `VISUAL_ASSET_CAPTURE_ENABLED=true`
  - `VISUAL_ASSET_CAPTURE_MAX_PER_SOURCE=5`
  - `VISUAL_ASSET_STORE_ORIGINAL=true`
  - `VISUAL_ASSET_RETENTION_DAYS=30`
  - `VISUAL_ASSET_PHASH_ENABLED=true`
  - `VISUAL_ASSET_REVIEW_LG_MAX_SIDE=1600`
  - `VISUAL_ASSET_REVIEW_SM_MAX_SIDE=768`
  - `VISUAL_ASSET_REVIEW_FORMAT=webp`
  - `VISUAL_ASSET_REVIEW_LG_QUALITY=75`
  - `VISUAL_ASSET_REVIEW_SM_QUALITY=65`
  - `VISUAL_ASSET_LLM_MAX_BYTES=512000`
  - `VISUAL_ASSET_MIN_WIDTH=320`
  - `VISUAL_ASSET_MIN_HEIGHT=320`
  - `VISUAL_ASSET_MIN_SHARPNESS=80`
  - `VISUAL_ASSET_MIN_ENTROPY=2.5`
  - `VISUAL_ASSET_MAX_PHASH_DISTANCE=10`
  - `VISUAL_ASSET_HERO_SELECTOR_MAP_JSON` (optional)
- Start read-only (capture + metadata), then enable visual validation consumers.
