import { buildReelTimeline, reelPresentationSpec, reelSafeZonePixels } from '../../src/features/reel-director/presentationSpec.js';
import { requireAuthorizedReelPlan } from './authorization.js';
import { ReelRenderError } from './errors.js';

export const reelRenderManifestSchemaVersion = 'reel-render-manifest-v1';

export function buildReelRenderManifest(authorization, stagedAssets) {
  const canonicalPlan = requireAuthorizedReelPlan(authorization);
  const assetRows = normalizeAssetRows(stagedAssets);
  const expectedIds = new Set([
    ...canonicalPlan.scenes.map((scene) => scene.attachmentId),
    canonicalPlan.cover.attachmentId,
  ]);
  if (assetRows.length !== expectedIds.size) fail('REEL_RENDER_MEDIA_INVALID');
  const byAttachment = new Map();
  for (const row of assetRows) {
    if (!expectedIds.has(row.attachmentId) || byAttachment.has(row.attachmentId)) fail('REEL_RENDER_MEDIA_INVALID');
    byAttachment.set(row.attachmentId, row.path);
  }
  if ([...expectedIds].some((id) => !byAttachment.has(id))) fail('REEL_RENDER_MEDIA_MISSING');

  const timeline = buildReelTimeline(canonicalPlan);
  const sourceKeys = new Map([...expectedIds].map((id, index) => [id, `asset-${index + 1}`]));
  const manifest = Object.freeze({
    schemaVersion: reelRenderManifestSchemaVersion,
    width: reelPresentationSpec.width,
    height: reelPresentationSpec.height,
    fps: reelPresentationSpec.fps,
    durationMs: timeline.totalDurationMs,
    safeZone: Object.freeze(reelSafeZonePixels()),
    scenes: Object.freeze(canonicalPlan.scenes.map((scene, index) => Object.freeze({
      position: scene.position,
      sourceKey: sourceKeys.get(scene.attachmentId),
      startMs: timeline.items[index].startMs,
      endMs: timeline.items[index].endMs,
      durationMs: scene.durationMs,
      overlayText: scene.overlayText,
      secondaryText: scene.secondaryText ?? '',
      motionPreset: scene.motionPreset,
      cropStrategy: scene.cropStrategy,
      transitionOut: scene.transitionOut,
      transition: timeline.transitions.find((item) => item.fromIndex === index) ?? null,
    }))),
    brand: Object.freeze({
      enabled: canonicalPlan.brand.enabled,
      displayName: canonicalPlan.brand.displayName,
      cta: canonicalPlan.brand.cta,
      durationMs: canonicalPlan.brand.durationMs,
      startMs: canonicalPlan.brand.enabled ? timeline.items.at(-1).startMs : null,
      endMs: canonicalPlan.brand.enabled ? timeline.items.at(-1).endMs : null,
    }),
    cover: Object.freeze({
      sourceKey: sourceKeys.get(canonicalPlan.cover.attachmentId),
      title: canonicalPlan.cover.title,
    }),
  });
  const sourcePaths = new Map([...sourceKeys].map(([attachmentId, sourceKey]) => [sourceKey, byAttachment.get(attachmentId)]));
  return { manifest, sourcePaths };
}

function normalizeAssetRows(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 7) fail('REEL_RENDER_MEDIA_INVALID');
  return value.map((row) => {
    if (!plainObject(row) || Object.keys(row).sort().join(',') !== 'attachmentId,path'
      || typeof row.attachmentId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(row.attachmentId)
      || typeof row.path !== 'string' || !row.path || /^(?:https?|file):/i.test(row.path)) {
      fail('REEL_RENDER_MEDIA_INVALID');
    }
    return { attachmentId: row.attachmentId, path: row.path };
  });
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function fail(code = 'REEL_RENDER_INVALID_PLAN') {
  throw new ReelRenderError(code);
}
