export const reelRenderTopic = 'servicescope-reel-render-v1';
export const reelRenderMessageSchema = 'reel-render-job-message-v1';
export const reelRendererVersion = 'servicescope-reel-renderer-v1';
export const reelRenderBucket = 'company-reel-renders';
export const reelArtifactTtlSeconds = 300;
export const reelRenderRequestMaxBytes = 2048;

const requestFields = new Set(['creativePlanId', 'expectedPlanRevision']);
const messageFields = new Set(['schemaVersion', 'renderJobId']);
const artifactFields = new Set(['renderJobId']);
export const safeRenderErrorCodes = Object.freeze([
  'REEL_RENDER_INVALID_PLAN', 'REEL_RENDER_UNAUTHORIZED', 'REEL_RENDER_AUDIO_UNSUPPORTED',
  'REEL_RENDER_MEDIA_INVALID', 'REEL_RENDER_MEDIA_MISSING', 'REEL_RENDER_TEXT_OVERFLOW',
  'REEL_RENDER_TIMEOUT', 'REEL_RENDER_FAILED', 'REEL_RENDER_OUTPUT_INVALID', 'REEL_RENDER_CONTEXT_STALE',
]);

export function parseRenderRequest(value) {
  const row = exactObject(value, requestFields);
  return {
    creativePlanId: uuid(row.creativePlanId),
    expectedPlanRevision: exactId(row.expectedPlanRevision, 180),
  };
}

export function parseRenderMessage(value) {
  const row = exactObject(value, messageFields);
  if (row.schemaVersion !== reelRenderMessageSchema) throw new RenderJobError('INVALID_REQUEST', 400);
  return { schemaVersion: reelRenderMessageSchema, renderJobId: uuid(row.renderJobId) };
}

export function parseArtifactRequest(value) {
  const row = exactObject(value, artifactFields);
  return { renderJobId: uuid(row.renderJobId) };
}

export function renderMessage(renderJobId) {
  return { schemaVersion: reelRenderMessageSchema, renderJobId: uuid(renderJobId) };
}

export function normalizeRenderError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/REEL_(?:ANALYSIS|PRIVACY|GROUNDING|QUALITY|MEDIA_UNAVAILABLE)/.test(message)) return 'REEL_RENDER_CONTEXT_STALE';
  return safeRenderErrorCodes.find((code) => message.includes(code)) ?? 'REEL_RENDER_FAILED';
}

export class RenderJobError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function exactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RenderJobError('INVALID_REQUEST', 400);
  const keys = Object.keys(value);
  if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) throw new RenderJobError('INVALID_REQUEST', 400);
  return value;
}

function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new RenderJobError('INVALID_REQUEST', 400);
  }
  return value.toLowerCase();
}

function exactId(value, limit) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > limit || !/^[A-Za-z0-9:_-]+$/.test(value)) {
    throw new RenderJobError('INVALID_REQUEST', 400);
  }
  return value;
}
