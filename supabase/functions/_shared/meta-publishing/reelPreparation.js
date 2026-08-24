import { MetaPublishingError } from './contracts.js';
import { sha256Hex } from './photoPreparation.js';

export const FACEBOOK_REEL_BUCKET = 'company-reel-renders';
export const FACEBOOK_REEL_MIME_TYPE = 'video/mp4';
export const MAX_FACEBOOK_REEL_BYTES = 25_000_000;

export async function prepareFacebookReel({ render, companyId, jobId, deps }) {
  if (
    !render
    || String(render.company_id) !== companyId
    || String(render.job_id) !== jobId
    || render.status !== 'completed'
    || render.output_bucket !== FACEBOOK_REEL_BUCKET
    || render.video_object_path !== `${companyId}/${render.id}/reel.mp4`
    || render.width !== 1080
    || render.height !== 1920
    || render.fps !== 30
    || render.duration_ms < 3_000
    || render.duration_ms > 90_000
    || render.video_codec !== 'h264'
    || render.pixel_format !== 'yuv420p'
    || render.audio_streams !== 0
    || render.faststart !== true
    || !Number.isInteger(Number(render.file_size))
    || Number(render.file_size) < 1
    || Number(render.file_size) > MAX_FACEBOOK_REEL_BYTES
    || !/^[0-9a-f]{64}$/.test(String(render.video_sha256 ?? ''))
  ) {
    throw new MetaPublishingError('META_REEL_RENDER_INVALID');
  }

  const bytes = await deps.repository.downloadReelBytes({
    storageBucket: FACEBOOK_REEL_BUCKET,
    storagePath: render.video_object_path,
    maxBytes: MAX_FACEBOOK_REEL_BYTES,
  });
  if (bytes.byteLength !== Number(render.file_size)) {
    throw new MetaPublishingError('META_REEL_RENDER_INVALID');
  }
  const actualSha256 = (await sha256Hex(bytes, deps.cryptoApi)).slice(2);
  if (actualSha256 !== String(render.video_sha256)) {
    throw new MetaPublishingError('META_REEL_RENDER_INVALID');
  }

  return {
    renderJobId: String(render.id),
    bytes,
    byteLength: bytes.byteLength,
    sha256: actualSha256,
    mimeType: FACEBOOK_REEL_MIME_TYPE,
    durationMs: Number(render.duration_ms),
    width: Number(render.width),
    height: Number(render.height),
    fps: Number(render.fps),
    videoCodec: String(render.video_codec),
    pixelFormat: String(render.pixel_format),
    audioStreams: Number(render.audio_streams),
    faststart: render.faststart === true,
  };
}
