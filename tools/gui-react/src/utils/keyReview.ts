interface LanePendingInput {
  status?: string | null;
  userAcceptStatus?: string | null;
  override?: boolean | null;
}

/**
 * A lane is pending only when no terminal human/AI decision exists.
 */
export function isKeyReviewLanePending({
  status,
  userAcceptStatus,
  override,
}: LanePendingInput): boolean {
  const statusNorm = String(status || '').trim().toLowerCase();
  const userAcceptNorm = String(userAcceptStatus || '').trim().toLowerCase();
  if (statusNorm === 'confirmed') return false;
  if (userAcceptNorm === 'accepted') return false;
  if (Boolean(override)) return false;
  return true;
}
