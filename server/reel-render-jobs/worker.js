import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authorizeReelForRender } from '../reel-renderer/authorization.js';
import { renderAuthorizedReel } from '../reel-renderer/renderer.js';
import { normalizeRenderError, parseRenderMessage, reelRenderBucket, RenderJobError } from './contracts.js';

export function createRenderWorker({ repository, authorize = authorizeReelForRender, render = renderAuthorizedReel }) {
  return async function process(message) {
    const { renderJobId } = parseRenderMessage(message);
    const claim = await repository.claim(renderJobId);
    if (!claim) {
      if (await repository.status(renderJobId) === 'completed') return { status: 'completed', rendered: false };
      throw new RenderJobError('REEL_RENDER_BUSY', 409);
    }
    let stagingRoot;
    let output;
    try {
      const authority = await repository.loadAuthority(claim);
      const authorized = authorize({ plan: authority.plan, context: authority.context });
      stagingRoot = await mkdtemp(join(tmpdir(), 'servicescope-reel-stage-'));
      const stagedAssets = [];
      let index = 0;
      for (const [attachmentId, bytes] of authority.assets) {
        const relativePath = `asset-${++index}.bin`;
        await writeFile(join(stagingRoot, relativePath), bytes);
        stagedAssets.push({ attachmentId, path: relativePath });
      }
      output = await render({ authorized, stagedAssets, stagingRoot });
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
      if (terminal(error, code)) await repository.fail(claim.id, claim.lease_token, code).catch(() => {});
      throw new RenderJobError(code, 500);
    } finally {
      if (output) await output.dispose().catch(() => {});
      if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true });
    }
  };
}

function terminal(error, code) {
  if (error instanceof RenderJobError && error.code === 'REEL_RENDER_SERVICE_UNAVAILABLE') return false;
  return code !== 'REEL_RENDER_FAILED' || !/SERVICE_UNAVAILABLE/.test(String(error));
}
