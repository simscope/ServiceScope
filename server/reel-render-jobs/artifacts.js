import { parseArtifactRequest, reelArtifactTtlSeconds, reelRenderBucket, reelRenderRequestMaxBytes, RenderJobError } from './contracts.js';

export function createArtifactHandler({ client, clock = Date }) {
  return async function handle(request) {
    try {
      if (request.method !== 'POST') return Response.json({ code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
      const session = await client.authenticate(request.headers.get('authorization') ?? '');
      if (Number(request.headers.get('content-length') ?? 0) > reelRenderRequestMaxBytes) throw new RenderJobError('INVALID_REQUEST', 400);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > reelRenderRequestMaxBytes) throw new RenderJobError('INVALID_REQUEST', 400);
      let input;
      try { input = parseArtifactRequest(JSON.parse(raw || '{}')); }
      catch { throw new RenderJobError('INVALID_REQUEST', 400); }
      const jobs = await client.select('company_reel_render_jobs', `select=id,job_id,status,output_bucket,video_object_path,cover_object_path&id=eq.${encodeURIComponent(input.renderJobId)}&limit=1`);
      const job = jobs?.[0];
      if (!job || job.status !== 'completed' || job.output_bucket !== reelRenderBucket) throw new RenderJobError('REEL_RENDER_NOT_READY', 409);
      const workspace = await client.userRpc('get_company_reel_workspace', { p_job_id: job.job_id }, session.token);
      if (!Array.isArray(workspace) || workspace[0]?.render_job_id !== job.id) throw new RenderJobError('FORBIDDEN', 404);
      const [video, cover] = await Promise.all([
        client.sign(reelRenderBucket, job.video_object_path, reelArtifactTtlSeconds),
        client.sign(reelRenderBucket, job.cover_object_path, reelArtifactTtlSeconds),
      ]);
      return Response.json({
        videoUrl: signedUrl(video), coverUrl: signedUrl(cover),
        expiresAt: new Date(clock.now() + reelArtifactTtlSeconds * 1000).toISOString(),
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const status = error instanceof RenderJobError ? error.status : 500;
      const code = error instanceof RenderJobError ? error.code : 'INTERNAL_ERROR';
      return Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
  };
}

function signedUrl(value) {
  const path = value?.signedURL ?? value?.signedUrl;
  if (typeof path !== 'string' || !path) throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
  if (!path.startsWith('https://')) throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
  return path;
}
