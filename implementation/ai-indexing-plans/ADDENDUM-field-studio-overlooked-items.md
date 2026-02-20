# Field Studio Overlooked Items Addendum (Phase-mapped)

Goal: add high-value Field Studio wiring that improves accuracy, explainability, and runtime efficiency.

This addendum maps overlooked Studio knobs/features into the existing phase plan so each item has a clear implementation slot and GUI proof.

## A) Phase 01 (NeedSet): policy-aware need scoring

Add to Phase 01 implementation:
- Pull per-field evidence.tier_preference and evidence.min_evidence_refs from compiled field rules, not only global defaults.
- Add policy-aware reason tags to NeedSet rows:
  - tier_pref_unmet
  - min_refs_fail
  - conflict_unresolved
- Include selection_policy and priority.publish_gate in NeedSet metadata so the planner can prioritize publish blockers first.

Why this helps:
- NeedSet becomes a true contract-driven controller, not just confidence math.

GUI proof:
- NeedSet table shows policy columns (tier preference, publish gate, selection policy) and badges for policy deficits.

## B) Phase 02 + 03 (Search): use Field Studio search hints directly

Add to Phase 02/03 implementation:
- Wire search_hints.query_terms into per-field query generation.
- Wire search_hints.domain_hints into provider query expansion (site: constraints / domain boosts).
- Wire search_hints.preferred_content_types into doc_hint emission and triage scoring.
- Include optional ui.tooltip_md terms as low-weight fallback hints after normalization and stopword filtering.
- Persist hint provenance per emitted query:
  - hint_source: field_rules.search_hints | learned | deterministic | llm

Why this helps:
- Uses curated Studio knowledge before guessing aliases.
- Reduces noisy queries and improves first-pass hit quality.

GUI proof:
- Search Profile / SERP panels show each query with hint_source and target fields.

## C) Phase 07 (Retrieval): enforce tier preference + anchor intent

Add to Phase 07 implementation:
- Use field-level evidence.tier_preference to modify retrieval rank weights per field.
- Add field-specific anchor packs from Field Studio artifacts before learned anchors.
- Include parse-unit cues (contract.unit, parse template intent) in retrieval query assembly.

Why this helps:
- Retrieval ranking matches contract intent per field.

GUI proof:
- Per-field retrieval hit list shows rank contributions: tier_pref, anchor_match, unit_match, doc_kind_match.

## D) Phase 08 (Extraction): richer contract context + unknown policy

Add to Phase 08 implementation:
- Include these contract fields in prompt assembly:
  - ui.label
  - ui.tooltip_md (trimmed)
  - ai_assist.reasoning_note
  - parse.template
  - enum source metadata
- Wire unknown handling knobs:
  - contract.unknown_token
  - contract.unknown_reason_required
  - unknown_reason_default
- Enforce that unknown outputs follow policy (token + reason presence).

Why this helps:
- Improves extraction precision and consistent unknown behavior.

GUI proof:
- Extraction panel shows prompt context preview for selected field (label, tooltip, policy summary).
- Unknown values show policy compliance status.

## E) Phase 09 (Convergence): key validation and migration guardrails

Add to Phase 09 implementation:
- Validate all runtime field keys against compiled contract at round boundaries.
- Apply key_migrations.json mapping for renamed/merged/split keys where configured.
- Reject unknown keys by default (with explicit metric/log), unless a migration rule applies.

Why this helps:
- Prevents silent key drift/typos (example: lngth) from poisoning retrieval/extraction loops.

GUI proof:
- Round summary includes key validation counters:
  - keys_validated
  - keys_migrated
  - keys_rejected

## F) Phase 10 (Learning): safe feedback into Studio suggestions

Add to Phase 10 implementation:
- Do not auto-edit generated Studio outputs during runs.
- Write suggestion artifacts for Studio review:
  - field_rules_suggestions.search_hints.json
  - field_rules_suggestions.anchors.json
  - field_rules_suggestions.known_values.json
- Each suggestion row must include evidence and acceptance stats.

Why this helps:
- Keeps learning safe and auditable while still compounding value.

GUI proof:
- Learning Feed links each accepted learning item to a pending Studio suggestion row.

## G) Cross-cutting: knob coverage + dead knob audit

Add cross-phase requirement:
- Keep src/field-rules/capabilities.json as the source of knob truth.
- Add CI checks:
  - every status=live knob must have at least one runtime consumer test
  - every status=deferred knob must reference planned phase or rationale
- Emit runtime knob usage telemetry per run so dead knobs are visible.

Why this helps:
- Prevents control-plane drift and ensures every visible knob has a purpose.

## Acceptance Criteria (Addendum)

- Field Studio search_hints materially changes emitted queries and is visible in GUI provenance.
- NeedSet and retrieval become field-policy aware (tier/min_refs/publish gates).
- Unknown key/unknown value behavior is deterministic and logged.
- Learning updates are converted into Studio suggestions, not silent contract mutation.
- Knob coverage report is generated in CI and attached to release artifacts.
