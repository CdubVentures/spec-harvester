# PHASE-08B IMPROVMENT

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
