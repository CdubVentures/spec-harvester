function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function toKey(value) {
  return String(value || '').trim().toLowerCase();
}

function hash32(text) {
  let hash = 2166136261;
  const str = String(text || '');
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function uniform(seed) {
  const h = hash32(seed);
  return (h + 1) / 4294967297;
}

function normalFromSeed(seed) {
  const u1 = clamp(uniform(`${seed}:u1`), 1e-8, 1 - 1e-8);
  const u2 = clamp(uniform(`${seed}:u2`), 1e-8, 1 - 1e-8);
  const mag = Math.sqrt(-2 * Math.log(u1));
  return mag * Math.cos(2 * Math.PI * u2);
}

function betaMean(alpha, beta) {
  return alpha / Math.max(1e-9, alpha + beta);
}

function betaVar(alpha, beta) {
  const denom = (alpha + beta) ** 2 * (alpha + beta + 1);
  if (denom <= 0) {
    return 0;
  }
  return (alpha * beta) / denom;
}

function thompsonApprox(alpha, beta, seed) {
  const mean = betaMean(alpha, beta);
  const variance = Math.max(0, betaVar(alpha, beta));
  const std = Math.sqrt(variance);
  const z = clamp(normalFromSeed(seed), -3, 3);
  return clamp(mean + (z * std), 0, 1);
}

function parseFinite(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function infoNeedScore(row) {
  const missingCritical = Math.max(0, row.missingCriticalCount || 0);
  const fieldsBelow = Math.max(0, row.fieldsBelowPassCount || 0);
  const contradictions = Math.max(0, row.contradictionCount || 0);
  const hypotheses = Math.max(0, row.hypothesisQueueCount || 0);
  const coldStart = row.hasHistory ? 0 : 0.5;

  const score =
    (missingCritical * 0.22) +
    (fieldsBelow * 0.04) +
    (contradictions * 0.18) +
    (hypotheses * 0.03) +
    coldStart;
  return clamp(score, 0, 2);
}

function buildBanditArm(row, brandReward = 0) {
  const confidence = clamp(parseFinite(row.confidence, 0), 0, 1);
  const validated = Boolean(row.validated);
  const contradictions = Math.max(0, row.contradictionCount || 0);
  const missingCritical = Math.max(0, row.missingCriticalCount || 0);
  const hasHistory = Boolean(row.hasHistory);

  const successEvidence =
    (validated ? 1.4 : 0.2) +
    (confidence * 1.4) +
    Math.max(0, brandReward) * 1.1;
  const failureEvidence =
    ((1 - confidence) * 1.2) +
    (contradictions * 0.35) +
    (missingCritical * 0.12) +
    Math.max(0, -brandReward) * 1.2;

  const alpha = 1 + successEvidence;
  const beta = 1 + failureEvidence;

  const pullCount =
    1 +
    (hasHistory ? 5 : 0) +
    (validated ? 2 : 0) +
    clamp(Math.floor((row.confidence || 0) * 3), 0, 3);

  return {
    alpha,
    beta,
    pullCount,
    infoNeed: infoNeedScore(row)
  };
}

export function rankBatchWithBandit({
  metadataRows = [],
  brandRewardIndex = {},
  seed = 'default-bandit-seed',
  mode = 'balanced'
}) {
  const rows = metadataRows
    .filter((row) => row && row.key)
    .map((row) => {
      const brandKey = toKey(row.brandKey || row.brand || '');
      const brandReward = parseFinite(brandRewardIndex[brandKey], 0);
      const arm = buildBanditArm(row, brandReward);
      return {
        ...row,
        brandKey,
        brandReward,
        ...arm
      };
    });

  const totalPulls = rows.reduce((sum, row) => sum + row.pullCount, 0);
  const explorationBase = mode === 'explore'
    ? 0.7
    : mode === 'exploit'
      ? 0.25
      : 0.45;

  const scored = rows.map((row) => {
    const mean = betaMean(row.alpha, row.beta);
    const variance = Math.max(0, betaVar(row.alpha, row.beta));
    const thompson = thompsonApprox(row.alpha, row.beta, `${seed}:${row.key}`);
    const ucb = mean + (explorationBase * Math.sqrt(Math.log(totalPulls + 1) / Math.max(1, row.pullCount)));
    const infoNeedNorm = clamp(row.infoNeed / 2, 0, 1);

    let score = 0;
    if (mode === 'explore') {
      score = (thompson * 0.3) + (ucb * 0.25) + (infoNeedNorm * 0.45);
    } else if (mode === 'exploit') {
      score = (thompson * 0.6) + (ucb * 0.35) + (infoNeedNorm * 0.05);
    } else {
      score = (thompson * 0.45) + (ucb * 0.3) + (infoNeedNorm * 0.25);
    }

    return {
      ...row,
      mean_reward: Number.parseFloat(mean.toFixed(6)),
      variance: Number.parseFloat(variance.toFixed(6)),
      thompson: Number.parseFloat(thompson.toFixed(6)),
      ucb: Number.parseFloat(ucb.toFixed(6)),
      info_need: Number.parseFloat(infoNeedNorm.toFixed(6)),
      bandit_score: Number.parseFloat(score.toFixed(6))
    };
  });

  scored.sort((a, b) => {
    if (b.bandit_score !== a.bandit_score) {
      return b.bandit_score - a.bandit_score;
    }
    return String(a.key).localeCompare(String(b.key));
  });

  return {
    orderedKeys: scored.map((row) => row.key),
    scored
  };
}
