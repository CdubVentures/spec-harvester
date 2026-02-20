function normalizeField(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function hasKnownValue(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a';
}

function parseNumber(value) {
  const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

const TIER_WEIGHTS = {
  tier1_manufacturer: 0.3,
  tier2_lab: 0.28,
  tier3_retailer: 0.2,
  tier4_community: 0.12,
  tier5_aggregator: 0.1
};

const METHOD_WEIGHTS = {
  spec_table_match: 0.3,
  parse_template: 0.28,
  pdf_table: 0.3,
  pdf_kv: 0.29,
  pdf: 0.24,
  scanned_pdf_ocr_table: 0.28,
  scanned_pdf_ocr_kv: 0.26,
  scanned_pdf_ocr_text: 0.2,
  json_ld: 0.25,
  microdata: 0.24,
  opengraph: 0.2,
  microformat: 0.19,
  rdfa: 0.19,
  twitter_card: 0.19,
  llm_extract: 0.2,
  component_db_inference: 0.15
};

function withDefaultSource(candidate = {}) {
  return {
    ...candidate,
    source: {
      tier: String(candidate?.source?.tier || 'tier4_community'),
      url: String(candidate?.source?.url || '')
    }
  };
}

export class CandidateMerger {
  constructor(engine) {
    this.engine = engine;
  }

  getFieldRule(field) {
    if (typeof this.engine?.getFieldRule === 'function') {
      return this.engine.getFieldRule(field) || {};
    }
    return {};
  }

  computeScore(field, candidate) {
    const rule = this.getFieldRule(field);
    let score = 0;
    score += TIER_WEIGHTS[String(candidate?.source?.tier || '')] || 0.1;
    score += METHOD_WEIGHTS[String(candidate?.method || '')] || 0.15;
    if (Array.isArray(rule?.preferred_source_hosts)) {
      const url = String(candidate?.source?.url || '');
      if (rule.preferred_source_hosts.some((host) => url.includes(host))) {
        score += 0.15;
      }
    }
    if (Array.isArray(candidate?.evidenceRefs) && candidate.evidenceRefs.length > 0) {
      score += 0.15;
    }
    if (candidate?.snippetHash) {
      score += 0.05;
    }
    score += Number(candidate?.confidence || 0) * 0.1;
    return Math.min(1, score);
  }

  resolveConflict(field, scored) {
    const rule = this.getFieldRule(field);
    const top = scored[0];
    const runner = scored[1];
    const dataType = String(rule?.data_type || '').toLowerCase();

    if (top && runner && (dataType === 'number' || dataType === 'integer')) {
      const topNumber = parseNumber(top.value);
      const runnerNumber = parseNumber(runner.value);
      if (topNumber !== null && runnerNumber !== null) {
        const tolerance = Math.abs(topNumber) * 0.05;
        const diff = Math.abs(topNumber - runnerNumber);
        if (diff <= tolerance) {
          return {
            value: top.value,
            confidence: 0.85,
            candidates: scored,
            agreement: 'within_tolerance',
            selected_reason: 'values_within_tolerance'
          };
        }
      }
    }

    if (rule?.source_dependent) {
      return {
        value: top?.value ?? 'unk',
        confidence: 0.7,
        candidates: scored,
        agreement: 'source_dependent',
        selected_reason: 'source_dependent_field',
        needs_review: true
      };
    }

    if (top && runner && (top.composite_score - runner.composite_score) < 0.1) {
      return {
        value: top.value,
        confidence: 0.5,
        candidates: scored,
        agreement: 'conflict',
        selected_reason: 'conflicting_sources_similar_authority',
        needs_review: true
      };
    }

    return {
      value: top?.value ?? 'unk',
      confidence: top?.composite_score || 0,
      candidates: scored,
      agreement: 'winner_clear',
      selected_reason: 'highest_scored_candidate'
    };
  }

  mergeCandidates({
    deterministicCandidates = [],
    llmCandidates = [],
    componentCandidates = []
  } = {}) {
    const all = [
      ...deterministicCandidates,
      ...llmCandidates,
      ...componentCandidates
    ]
      .filter((row) => normalizeField(row?.field) && hasKnownValue(row?.value))
      .map((row) => ({
        ...withDefaultSource(row),
        field: normalizeField(row.field)
      }));

    const byFieldList = new Map();
    for (const row of all) {
      if (!byFieldList.has(row.field)) {
        byFieldList.set(row.field, []);
      }
      byFieldList.get(row.field).push(row);
    }

    const byField = {};
    const winners = [];
    for (const [field, rows] of byFieldList.entries()) {
      const scored = rows
        .map((candidate) => ({
          ...candidate,
          composite_score: this.computeScore(field, candidate)
        }))
        .sort((a, b) => b.composite_score - a.composite_score);

      const uniqueValues = [...new Set(scored.map((row) => String(row.value)))];
      let result;
      if (uniqueValues.length === 1) {
        result = {
          value: scored[0].value,
          confidence: Math.min(1, scored[0].composite_score + 0.1),
          candidates: scored,
          agreement: 'unanimous',
          selected_reason: 'all_sources_agree'
        };
      } else {
        result = this.resolveConflict(field, scored);
      }
      byField[field] = result;
      winners.push({
        ...scored[0],
        value: result.value
      });
    }

    return {
      byField,
      winners
    };
  }
}
