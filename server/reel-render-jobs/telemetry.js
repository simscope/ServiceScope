const eventNames = new Set([
  'render_requested', 'render_blocked_feature_flag', 'render_blocked_privacy',
  'claim_acquired', 'claim_rejected', 'sandbox_started', 'sandbox_failed',
  'ffmpeg_started', 'ffmpeg_completed', 'ffmpeg_failed', 'render_timeout',
  'output_validated', 'output_rejected', 'render_completed', 'cleanup_completed',
]);
const safeCodes = /^[A-Z][A-Z0-9_]{1,79}$/;
const safeIds = /^[0-9a-f-]{1,64}$/i;

export function createRenderTelemetry(write = (entry) => console.info(JSON.stringify(entry)), clock = Date) {
  return {
    record(event, fields = {}) {
      if (!eventNames.has(event)) return;
      const entry = { component: 'reel-render-pipeline', event, at: new Date(clock.now()).toISOString() };
      if (safeIds.test(fields.renderJobId ?? '')) entry.renderJobId = fields.renderJobId;
      if (safeCodes.test(fields.code ?? '')) entry.code = fields.code;
      if (Number.isSafeInteger(fields.attempt) && fields.attempt >= 0 && fields.attempt <= 5) entry.attempt = fields.attempt;
      try { write(Object.freeze(entry)); } catch { /* Telemetry must never alter render control flow. */ }
    },
  };
}

export function recordRenderEvent(telemetry, event, fields) {
  try { telemetry?.record?.(event, fields); } catch { /* Injected test/log sinks are non-authoritative. */ }
}
