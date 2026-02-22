import { normalizeWhitespace } from '../../utils/common.js';
import { buildEvidenceCandidateFingerprint } from '../../llm/evidencePack.js';

export function selectAggressiveEvidencePack(sourceResults = []) {
  const ranked = (sourceResults || [])
    .filter((row) => row?.llmEvidencePack)
    .sort((a, b) => {
      const aIdentity = a.identity?.match ? 1 : 0;
      const bIdentity = b.identity?.match ? 1 : 0;
      if (bIdentity !== aIdentity) {
        return bIdentity - aIdentity;
      }
      const aAnchor = (a.anchorCheck?.majorConflicts || []).length;
      const bAnchor = (b.anchorCheck?.majorConflicts || []).length;
      if (aAnchor !== bAnchor) {
        return aAnchor - bAnchor;
      }
      const aSnippets = Number(a.llmEvidencePack?.meta?.snippet_count || 0);
      const bSnippets = Number(b.llmEvidencePack?.meta?.snippet_count || 0);
      if (bSnippets !== aSnippets) {
        return bSnippets - aSnippets;
      }
      return Number(a.tier || 99) - Number(b.tier || 99);
    });
  return ranked[0]?.llmEvidencePack || null;
}

export function selectAggressiveDomHtml(artifactsByHost = {}) {
  let best = '';
  for (const row of Object.values(artifactsByHost || {})) {
    const html = String(row?.html || '');
    if (html.length > best.length) {
      best = html;
    }
  }
  return best;
}

export function buildDomSnippetArtifact(html = '', maxChars = 3_600) {
  const pageHtml = String(html || '');
  if (!pageHtml) return null;
  const cap = Math.max(600, Math.min(20_000, Number(maxChars || 3_600)));
  const candidates = [
    { kind: 'table', pattern: /<table[\s\S]*?<\/table>/i },
    { kind: 'definition_list', pattern: /<dl[\s\S]*?<\/dl>/i },
    { kind: 'spec_section', pattern: /<(section|div)[^>]*(?:spec|technical|feature|performance)[^>]*>[\s\S]*?<\/\1>/i }
  ];
  for (const candidate of candidates) {
    const match = pageHtml.match(candidate.pattern);
    if (match?.[0]) {
      const snippetHtml = String(match[0]).slice(0, cap);
      return {
        kind: candidate.kind,
        html: snippetHtml,
        char_count: snippetHtml.length
      };
    }
  }
  const lower = pageHtml.toLowerCase();
  const pivot = Math.max(0, lower.search(/spec|technical|feature|performance|dimension|polling|sensor|weight/));
  const start = Math.max(0, pivot > 0 ? pivot - Math.floor(cap * 0.25) : 0);
  const end = Math.min(pageHtml.length, start + cap);
  const snippetHtml = pageHtml.slice(start, end);
  if (!snippetHtml.trim()) return null;
  return {
    kind: 'html_window',
    html: snippetHtml,
    char_count: snippetHtml.length
  };
}

export function normalizedSnippetRows(evidencePack) {
  if (!evidencePack) {
    return [];
  }
  if (Array.isArray(evidencePack.snippets)) {
    return evidencePack.snippets
      .map((row) => ({
        id: String(row?.id || '').trim(),
        text: normalizeWhitespace(String(row?.normalized_text || row?.text || '')).toLowerCase()
      }))
      .filter((row) => row.id && row.text);
  }
  if (evidencePack.snippets && typeof evidencePack.snippets === 'object') {
    return Object.entries(evidencePack.snippets)
      .map(([id, row]) => ({
        id: String(id || '').trim(),
        text: normalizeWhitespace(String(row?.normalized_text || row?.text || '')).toLowerCase()
      }))
      .filter((row) => row.id && row.text);
  }
  return [];
}

export function enrichFieldCandidatesWithEvidenceRefs(fieldCandidates = [], evidencePack = null) {
  const deterministicBindings = evidencePack?.candidate_bindings && typeof evidencePack.candidate_bindings === 'object'
    ? evidencePack.candidate_bindings
    : {};
  const snippetRows = normalizedSnippetRows(evidencePack);
  if (!snippetRows.length && !Object.keys(deterministicBindings).length) {
    return fieldCandidates;
  }

  return (fieldCandidates || []).map((candidate) => {
    const existingRefs = Array.isArray(candidate?.evidenceRefs)
      ? candidate.evidenceRefs.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (existingRefs.length > 0) {
      return candidate;
    }

    const deterministicFingerprint = buildEvidenceCandidateFingerprint(candidate);
    const deterministicSnippetId = deterministicBindings[deterministicFingerprint];
    if (deterministicSnippetId) {
      return {
        ...candidate,
        evidenceRefs: [deterministicSnippetId],
        evidenceRefOrigin: 'deterministic_binding'
      };
    }

    const value = normalizeWhitespace(String(candidate?.value || '')).toLowerCase();
    if (!value || value === 'unk') {
      return candidate;
    }
    const fieldToken = String(candidate?.field || '').replace(/_/g, ' ').toLowerCase().trim();

    let match = snippetRows.find((row) => row.text.includes(value) && (!fieldToken || row.text.includes(fieldToken)));
    if (!match) {
      match = snippetRows.find((row) => row.text.includes(value));
    }
    if (!match) {
      return candidate;
    }

    return {
      ...candidate,
      evidenceRefs: [match.id],
      evidenceRefOrigin: 'heuristic_snippet_match'
    };
  });
}

export function buildTopEvidenceReferences(provenance, limit = 60) {
  const rows = [];
  const seen = new Set();
  for (const [field, row] of Object.entries(provenance || {})) {
    for (const evidence of row?.evidence || []) {
      const key = `${field}|${evidence.url}|${evidence.keyPath}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push({
        field,
        url: evidence.url,
        host: evidence.host,
        method: evidence.method,
        keyPath: evidence.keyPath,
        tier: evidence.tier,
        tier_name: evidence.tierName
      });
      if (rows.length >= limit) {
        return rows;
      }
    }
  }
  return rows;
}
