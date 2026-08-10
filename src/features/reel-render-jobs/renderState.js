export function reelPlanIdentity(creativePlanId, planRevision) {
  return { creativePlanId, planRevision };
}

export function persistedReelPlanIdentity(workspace) {
  return reelPlanIdentity(workspace?.creative_plan_id, workspace?.plan_revision);
}

export function sameReelPlanIdentity(left, right) {
  return Boolean(
    left?.creativePlanId
    && left?.planRevision
    && left.creativePlanId === right?.creativePlanId
    && left.planRevision === right?.planRevision,
  );
}

export function idleReelRender(identity) {
  return { ...identity, status: 'idle' };
}

export function isReelRenderForPlan(render, identity) {
  return sameReelPlanIdentity(render, identity);
}

export function reconcileReelRenderForPlan(render, identity) {
  return isReelRenderForPlan(render, identity) ? render : idleReelRender(identity);
}

export function isReelAsyncScopeCurrent(started, current) {
  return started?.jobId === current?.jobId && started?.epoch === current?.epoch;
}
