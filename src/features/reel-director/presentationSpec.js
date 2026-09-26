export const reelPresentationSpec = Object.freeze({
  schemaVersion: 'reel-presentation-v1',
  visualProfile: 'service-story-v2',
  width: 1080,
  height: 1920,
  fps: 30,
  textFadeMs: 220,
  safeZone: Object.freeze({ top: 0.12, right: 0.14, bottom: 0.24, left: 0.09 }),
  text: Object.freeze({
    fontFamily: "Arial, 'Liberation Sans', 'DejaVu Sans', sans-serif",
    sceneLabel: Object.freeze({ minFontSize: 22, maxFontSize: 26, lineHeightRatio: 1.1, maxLines: 1, widthRatio: 0.44, maxHeightRatio: 0.05 }),
    scenePrimary: Object.freeze({ minFontSize: 46, maxFontSize: 74, lineHeightRatio: 1.16, maxLines: 3, widthRatio: 0.96, maxHeightRatio: 0.23 }),
    sceneSecondary: Object.freeze({ minFontSize: 28, maxFontSize: 40, lineHeightRatio: 1.28, maxLines: 3, widthRatio: 0.88, maxHeightRatio: 0.14 }),
    cover: Object.freeze({ minFontSize: 48, maxFontSize: 72, lineHeightRatio: 1.2, maxLines: 3, widthRatio: 1, maxHeightRatio: 0.2 }),
    brandDisplayName: Object.freeze({ minFontSize: 48, maxFontSize: 76, lineHeightRatio: 1.2, maxLines: 3, widthRatio: 0.72, maxHeightRatio: 0.18 }),
    brandCta: Object.freeze({ minFontSize: 30, maxFontSize: 44, lineHeightRatio: 1.3, maxLines: 3, widthRatio: 0.72, maxHeightRatio: 0.12 }),
  }),
  transitions: Object.freeze({
    cut: Object.freeze({ durationMs: 0, ffmpeg: 'none' }),
    crossfade: Object.freeze({ durationMs: 450, ffmpeg: 'fade' }),
    quick_fade: Object.freeze({ durationMs: 250, ffmpeg: 'fadeblack' }),
  }),
  crops: Object.freeze({
    cover_center: Object.freeze({ scale: 1, x: 0, y: 0 }),
    subject_center: Object.freeze({ scale: 1.02, x: 0, y: -0.04 }),
    detail_crop: Object.freeze({ scale: 1.12, x: 0, y: 0 }),
  }),
  motions: Object.freeze({
    slow_zoom_in: Object.freeze({ startScale: 1, endScale: 1.055, startX: 0, endX: 0, startY: 0, endY: 0 }),
    slow_zoom_out: Object.freeze({ startScale: 1.055, endScale: 1, startX: 0, endX: 0, startY: 0, endY: 0 }),
    pan_left: Object.freeze({ startScale: 1.07, endScale: 1.07, startX: 0.025, endX: -0.025, startY: 0, endY: 0 }),
    pan_right: Object.freeze({ startScale: 1.07, endScale: 1.07, startX: -0.025, endX: 0.025, startY: 0, endY: 0 }),
    focus_detail: Object.freeze({ startScale: 1.045, endScale: 1.12, startX: 0, endX: 0, startY: 0.012, endY: -0.012 }),
    static: Object.freeze({ startScale: 1, endScale: 1.025, startX: 0, endX: 0, startY: 0, endY: 0 }),
  }),
});

const reelBeforeTreatment = Object.freeze({ label: 'BEFORE', accent: '#fcd34d', emphasis: 'before' });
const reelSceneTreatments = Object.freeze({
  overview: Object.freeze({ label: 'OVERVIEW', accent: '#b8f28a', emphasis: 'standard' }),
  detail: Object.freeze({ label: 'DETAIL', accent: '#fde68a', emphasis: 'standard' }),
  repair_process: Object.freeze({ label: 'SERVICE', accent: '#93c5fd', emphasis: 'standard' }),
  replacement_part: Object.freeze({ label: 'PART', accent: '#c4b5fd', emphasis: 'standard' }),
  finished_result: Object.freeze({ label: 'RESULT', accent: '#d9f99d', emphasis: 'result' }),
  supporting_image: Object.freeze({ label: 'FIELD NOTE', accent: '#e2e8f0', emphasis: 'standard' }),
});

export function reelSceneTreatment(sceneRole, { marketingAngle, position } = {}) {
  const isSupportedBefore = marketingAngle === 'before_after'
    && position === 1
    && (sceneRole === 'overview' || sceneRole === 'detail');
  const treatment = isSupportedBefore ? reelBeforeTreatment : reelSceneTreatments[sceneRole];
  if (!treatment) throw new Error('REEL_PRESENTATION_INVALID');
  return treatment;
}

export function buildReelTimeline(plan) {
  const items = [];
  let cursor = 0;
  for (const scene of plan.scenes) {
    const startMs = cursor;
    const endMs = startMs + scene.durationMs;
    items.push({ kind: 'scene', startMs, endMs, scene });
    cursor = endMs;
  }
  if (plan.brand.enabled) {
    items.push({ kind: 'brand', startMs: cursor, endMs: cursor + plan.brand.durationMs });
    cursor += plan.brand.durationMs;
  }
  const transitions = items.flatMap((item, index) => {
    if (item.kind !== 'scene' || index === items.length - 1) return [];
    const spec = reelPresentationSpec.transitions[item.scene.transitionOut];
    if (!spec || spec.durationMs === 0) return [];
    return [{
      kind: item.scene.transitionOut,
      fromIndex: index,
      toIndex: index + 1,
      startMs: item.endMs - spec.durationMs,
      endMs: item.endMs,
      durationMs: spec.durationMs,
    }];
  });
  return { items, transitions, totalDurationMs: cursor };
}

export function activeReelFrame(timeline, elapsedMs) {
  const bounded = Math.max(0, Math.min(elapsedMs, timeline.totalDurationMs));
  const activeIndex = timeline.items.findIndex((item) => bounded >= item.startMs && bounded < item.endMs);
  const index = activeIndex >= 0 ? activeIndex : Math.max(0, timeline.items.length - 1);
  const item = timeline.items[index];
  const transition = timeline.transitions.find((candidate) => bounded >= candidate.startMs && bounded < candidate.endMs);
  return {
    item,
    index,
    elapsedInItemMs: item ? Math.max(0, bounded - item.startMs) : 0,
    transition: transition
      ? { ...transition, progress: (bounded - transition.startMs) / transition.durationMs, nextItem: timeline.items[transition.toIndex] }
      : undefined,
  };
}

export function reelMotionFrame(motionPreset, cropStrategy, progress) {
  const motion = reelPresentationSpec.motions[motionPreset];
  const crop = reelPresentationSpec.crops[cropStrategy];
  if (!motion || !crop) throw new Error('REEL_PRESENTATION_INVALID');
  const bounded = Math.max(0, Math.min(1, progress));
  return {
    scale: crop.scale * interpolate(motion.startScale, motion.endScale, bounded),
    x: crop.x + interpolate(motion.startX, motion.endX, bounded),
    y: crop.y + interpolate(motion.startY, motion.endY, bounded),
  };
}

export function reelSafeZonePixels() {
  const { width, height, safeZone } = reelPresentationSpec;
  const left = Math.round(width * safeZone.left);
  const top = Math.round(height * safeZone.top);
  const right = Math.round(width * (1 - safeZone.right));
  const bottom = Math.round(height * (1 - safeZone.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function interpolate(start, end, progress) {
  return start + ((end - start) * progress);
}
