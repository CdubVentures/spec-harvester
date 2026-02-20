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
  // User accept is independent from AI confirm; pending is controlled by AI lane status.
  void userAcceptStatus;
  if (Boolean(override)) return false;
  if (statusNorm === 'pending') return true;
  if (!statusNorm || statusNorm === 'not_run' || statusNorm === 'unknown') return false;
  if (statusNorm === 'confirmed' || statusNorm === 'rejected' || statusNorm === 'accepted') return false;
  return false;
}
