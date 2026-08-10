export const REEL_DISPATCH_RECOVERY_INTERVAL_MS = 60_000;

export function shouldRecoverReelDispatch(workspace, lastAttemptAt, now = Date.now()) {
  return workspace?.render_status === 'queued'
    && Boolean(workspace.render_job_id)
    && (lastAttemptAt === undefined || now - lastAttemptAt >= REEL_DISPATCH_RECOVERY_INTERVAL_MS);
}
