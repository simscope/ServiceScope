import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authorizeReelForRender } from '../reel-renderer/authorization.js';
import { renderAuthorizedReel } from '../reel-renderer/renderer.js';
import {
  normalizeRenderError,
  parseRenderMessage,
  reelRenderBucket,
  reelRenderMaxAggregateMediaBytes,
  reelRenderMaxAttempts,
  reelRenderMaxMediaItems,
  reelRendererVersion,
  RenderJobError,
} from './contracts.js';

export function createRenderWorker({
  repository,
  authorize = authorizeReelForRender,
  render = renderAuthorizedReel,
  createStagingRoot = () => mkdtemp(join(tmpdir(), 'servicescope-reel-stage-')),
}) {
  return async function process(message) {
    const { renderJobId } = parseRenderMessage(message);
    const claim = await repository.claim(renderJobId);
    if (!claim) {
      const status = await repository.status(renderJobId);
      if (status === 'completed' || status === 'failed' || status === null) {
        return { status: status ?? 'missing', rendered: false };
      }
      throw new RenderJobError('REEL_RENDER_BUSY', 409);
    }
    if (claim.renderer_version !== reelRendererVersion) {
      return failRendererVersionMismatch(repository, claim);
    }
    let stagingRoot;
    let output;
    try {
      const authority = await repository.loadAuthority(claim);
      const authorized = authorize({ plan: authority.plan, context: authority.context });
      assertAggregateAssets(authority.assets);
      stagingRoot = await createStagingRoot();
      const stagedAssets = [];
      let index = 0;
      for (const [attachmentId, bytes] of authority.assets) {
        const relativePath = `asset-${++index}.bin`;
        await writeFile(join(stagingRoot, relativePath), bytes);
        stagedAssets.push({ attachmentId, path: relativePath });
      }
      output = await render({
        authorized,
        authority: { plan: authority.plan, context: authority.context },
        stagedAssets,
        stagingRoot,
      });
      const paths = {
        bucket: reelRenderBucket,
        video: `${claim.company_id}/${claim.id}/reel.mp4`,
        cover: `${claim.company_id}/${claim.id}/cover.jpg`,
      };
      await repository.upload(paths.bucket, paths.video, await readFile(output.videoPath), 'video/mp4');
      await repository.upload(paths.bucket, paths.cover, await readFile(output.coverPath), 'image/jpeg');
      const completed = await repository.complete(claim.id, claim.lease_token, paths, output);
      if (!Array.isArray(completed) || completed.length !== 1) throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
      return { status: 'completed', rendered: true };
    } catch (error) {
      const code = normalizeRenderError(error);
      if (retryable(error)) return await retryOrFail(repository, claim);
      try {
        const failed = await repository.fail(claim.id, claim.lease_token, code);
        if (!oneRow(failed)) return await retryOrFail(repository, claim);
        return { status: 'failed', rendered: false, errorCode: code };
      } catch {
        return await retryOrFail(repository, claim);
      }
    } finally {
      if (output) await output.dispose().catch(() => {});
      if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true });
    }
  };
}

async function failRendererVersionMismatch(repository, claim) {
  try {
    const failed = await repository.fail(claim.id, claim.lease_token, 'REEL_RENDER_CONTEXT_STALE');
    if (oneRow(failed)) {
      return { status: 'failed', rendered: false, errorCode: 'REEL_RENDER_CONTEXT_STALE' };
    }
  } catch {
    // The existing release/retry lifecycle below prevents a stuck claimed lease.
  }
  return retryOrFail(repository, claim);
}

async function retryOrFail(repository, claim) {
  if (claim.attempt_count >= reelRenderMaxAttempts) {
    const failed = await repository.fail(claim.id, claim.lease_token, 'REEL_RENDER_FAILED');
    if (!oneRow(failed)) throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
    return { status: 'failed', rendered: false, errorCode: 'REEL_RENDER_FAILED' };
  }
  const released = await repository.release(claim.id, claim.lease_token);
  if (!oneRow(released)) throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
  throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
}

function retryable(error) {
  return error instanceof RenderJobError && error.code === 'REEL_RENDER_SERVICE_UNAVAILABLE';
}

function oneRow(value) {
  return Array.isArray(value) && value.length === 1;
}

function assertAggregateAssets(assets) {
  if (!(assets instanceof Map) || assets.size < 1 || assets.size > reelRenderMaxMediaItems) {
    throw new RenderJobError('REEL_RENDER_MEDIA_INVALID', 400);
  }
  let aggregateBytes = 0;
  for (const bytes of assets.values()) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
      throw new RenderJobError('REEL_RENDER_MEDIA_INVALID', 400);
    }
    aggregateBytes += bytes.byteLength;
    if (aggregateBytes > reelRenderMaxAggregateMediaBytes) {
      throw new RenderJobError('REEL_RENDER_MEDIA_INVALID', 400);
    }
  }
}
