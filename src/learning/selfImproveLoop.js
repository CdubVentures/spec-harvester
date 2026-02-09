import { toPosixKey } from '../s3/storage.js';

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function profileIdFromJob(job) {
  const category = job.category || 'mouse';
  const brand = slug(job.identityLock?.brand || 'unknown-brand');
  const model = slug(job.identityLock?.model || 'unknown-model');
  const variant = slug(job.identityLock?.variant || 'unknown-variant');
  return `${category}-${brand}-${model}-${variant}`;
}

function hasMajorAnchorConflict(source) {
  return (source.anchorCheck?.majorConflicts || []).length > 0;
}

function buildHostStats(sourceResults) {
  const byHost = new Map();

  for (const source of sourceResults || []) {
    if (!byHost.has(source.host)) {
      byHost.set(source.host, {
        host: source.host,
        rootDomain: source.rootDomain,
        tier: source.tier,
        tierName: source.tierName,
        approvedDomain: Boolean(source.approvedDomain),
        attempts: 0,
        identityMatches: 0,
        majorAnchorConflicts: 0,
        extractedCandidateCount: 0
      });
    }

    const row = byHost.get(source.host);
    row.attempts += 1;
    if (source.identity?.match) {
      row.identityMatches += 1;
    }
    if (hasMajorAnchorConflict(source)) {
      row.majorAnchorConflicts += 1;
    }
    row.extractedCandidateCount += (source.fieldCandidates || []).length;
  }

  for (const row of byHost.values()) {
    row.identityMatchRate = row.attempts === 0 ? 0 : row.identityMatches / row.attempts;
    row.conflictRate = row.attempts === 0 ? 0 : row.majorAnchorConflicts / row.attempts;
    row.yieldScore = Math.max(
      0,
      Number.parseFloat(
        (
          (row.identityMatchRate * 0.5) +
          (Math.min(1, row.extractedCandidateCount / Math.max(1, row.attempts * 30)) * 0.4) +
          ((1 - row.conflictRate) * 0.1)
        ).toFixed(4)
      )
    );
  }

  return [...byHost.values()].sort((a, b) => b.yieldScore - a.yieldScore);
}

function topPreferredUrls(sourceResults, limit = 12) {
  return [...new Set(
    (sourceResults || [])
      .filter((source) => source.approvedDomain)
      .filter((source) => source.identity?.match)
      .filter((source) => (source.anchorCheck?.majorConflicts || []).length === 0)
      .sort((a, b) => a.tier - b.tier)
      .map((source) => source.url)
  )].slice(0, limit);
}

function topHypothesisUrls(summary, limit = 20) {
  const urls = [];
  for (const row of summary?.hypothesis_queue || []) {
    for (const suggestion of row.suggestions || []) {
      urls.push({
        url: suggestion.url,
        field: row.field,
        score: suggestion.score || 0,
        reason: suggestion.reason || 'hypothesis'
      });
    }
  }
  return urls
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, Math.max(1, limit));
}

function topUncertainFields(summary, limit = 12) {
  return (summary?.constraint_analysis?.top_uncertain_fields || [])
    .slice(0, Math.max(1, limit))
    .map((row) => ({
      field: row.field,
      uncertainty: row.uncertainty
    }));
}

function summarizeParserHealth(sourceResults) {
  const rows = (sourceResults || [])
    .map((source) => source.parserHealth)
    .filter(Boolean);
  if (!rows.length) {
    return {
      average_health_score: 0,
      source_count: 0
    };
  }

  const avg = rows.reduce((sum, row) => sum + (row.health_score || 0), 0) / rows.length;
  return {
    average_health_score: Number.parseFloat(avg.toFixed(6)),
    source_count: rows.length
  };
}

function mergeProfiles(previous, next) {
  if (!previous) {
    return next;
  }

  const mergedHostStats = new Map();
  for (const row of previous.host_stats || []) {
    mergedHostStats.set(row.host, { ...row });
  }

  for (const row of next.host_stats || []) {
    const prev = mergedHostStats.get(row.host);
    if (!prev) {
      mergedHostStats.set(row.host, { ...row });
      continue;
    }

    const attempts = prev.attempts + row.attempts;
    mergedHostStats.set(row.host, {
      ...row,
      attempts,
      identityMatches: prev.identityMatches + row.identityMatches,
      majorAnchorConflicts: prev.majorAnchorConflicts + row.majorAnchorConflicts,
      extractedCandidateCount: prev.extractedCandidateCount + row.extractedCandidateCount,
      identityMatchRate: attempts === 0 ? 0 : (prev.identityMatches + row.identityMatches) / attempts,
      conflictRate: attempts === 0 ? 0 : (prev.majorAnchorConflicts + row.majorAnchorConflicts) / attempts,
      yieldScore: Number.parseFloat(((prev.yieldScore * 0.4) + (row.yieldScore * 0.6)).toFixed(4))
    });
  }

  const mergedPreferredUrls = [...new Set([...(next.preferred_urls || []), ...(previous.preferred_urls || [])])]
    .slice(0, 20);
  const mergedFeedbackUrls = [
    ...new Set([
      ...(next.feedback_urls || []).map((row) => row.url),
      ...(previous.feedback_urls || []).map((row) => row.url)
    ])
  ]
    .slice(0, 30)
    .map((url) => {
      const fromNext = (next.feedback_urls || []).find((row) => row.url === url);
      if (fromNext) {
        return fromNext;
      }
      const fromPrev = (previous.feedback_urls || []).find((row) => row.url === url);
      return fromPrev || { url, score: 0, field: '', reason: 'history' };
    });

  return {
    ...next,
    runs_total: (previous.runs_total || 0) + 1,
    validated_runs: (previous.validated_runs || 0) + (next.validated ? 1 : 0),
    preferred_urls: mergedPreferredUrls,
    feedback_urls: mergedFeedbackUrls,
    host_stats: [...mergedHostStats.values()].sort((a, b) => b.yieldScore - a.yieldScore),
    unknown_field_rate_avg: Number.parseFloat(
      (((previous.unknown_field_rate_avg || 0) * 0.5) + (next.unknown_field_rate * 0.5)).toFixed(4)
    ),
    parser_health_avg: Number.parseFloat(
      (((previous.parser_health_avg || 0) * 0.5) + ((next.parser_health?.average_health_score || 0) * 0.5)).toFixed(6)
    )
  };
}

export async function loadLearningProfile({ storage, config, category, job }) {
  const profileId = profileIdFromJob(job);
  const profileKey = toPosixKey(config.s3OutputPrefix, '_learning', category, 'profiles', `${profileId}.json`);

  const existing = await storage.readJsonOrNull(profileKey);
  return {
    profileId,
    profileKey,
    profile: existing
  };
}

export function applyLearningSeeds(planner, learningProfile) {
  const preferredUrls = learningProfile?.profile?.preferred_urls || [];
  const feedbackUrls = (learningProfile?.profile?.feedback_urls || [])
    .map((row) => row.url)
    .filter(Boolean);
  const seedUrls = [...new Set([...preferredUrls, ...feedbackUrls])];
  if (!seedUrls.length) {
    return;
  }
  planner.seed(seedUrls);
}

export async function persistLearningProfile({
  storage,
  config,
  category,
  job,
  sourceResults,
  summary,
  learningProfile,
  discoveryResult,
  runBase,
  runId
}) {
  const profileId = learningProfile.profileId;
  const profileKey = learningProfile.profileKey;

  const totalSchemaFields = (summary?.coverage_overall_percent || 0) / 100;
  const unknownFieldRate = Number.parseFloat((1 - totalSchemaFields).toFixed(4));
  const parserHealth = summarizeParserHealth(sourceResults);

  const current = {
    profile_id: profileId,
    category,
    identity_lock: {
      brand: job.identityLock?.brand || '',
      model: job.identityLock?.model || '',
      variant: job.identityLock?.variant || ''
    },
    updated_at: new Date().toISOString(),
    validated: Boolean(summary.validated),
    runs_total: 1,
    validated_runs: summary.validated ? 1 : 0,
    unknown_field_rate: unknownFieldRate,
    unknown_field_rate_avg: unknownFieldRate,
    preferred_urls: topPreferredUrls(sourceResults),
    feedback_urls: topHypothesisUrls(summary),
    uncertain_fields: topUncertainFields(summary),
    parser_health: parserHealth,
    parser_health_avg: parserHealth.average_health_score,
    critical_fields_below_pass_target: summary?.critical_fields_below_pass_target || [],
    host_stats: buildHostStats(sourceResults),
    last_run: {
      runId,
      validated: summary.validated,
      validated_reason: summary.validated_reason,
      confidence: summary.confidence,
      completeness_required_percent: summary.completeness_required_percent,
      coverage_overall_percent: summary.coverage_overall_percent,
      discovery_candidates: discoveryResult?.candidates?.length || 0,
      contradiction_count: summary?.constraint_analysis?.contradiction_count || 0,
      hypothesis_queue_count: (summary?.hypothesis_queue || []).length
    }
  };

  const merged = mergeProfiles(learningProfile.profile, current);

  await storage.writeObject(profileKey, Buffer.from(JSON.stringify(merged, null, 2), 'utf8'), {
    contentType: 'application/json'
  });

  const learningRunKey = `${runBase}/logs/learning.json`;
  await storage.writeObject(learningRunKey, Buffer.from(JSON.stringify(merged, null, 2), 'utf8'), {
    contentType: 'application/json'
  });

  return {
    profileKey,
    learningRunKey,
    profile: merged
  };
}
