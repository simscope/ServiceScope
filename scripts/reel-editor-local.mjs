// Explicit loopback-only demo; never imported by Production or a Vercel function.
import { resolve, join } from 'node:path';
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
process.env.FONTCONFIG_FILE = resolve('public/reel-editor/fonts/fonts.conf');
const { default: sharp } = await import('sharp');
const { createServer } = await import('vite');
const { newDraft, setMotion, frameSvg } = await import('../src/features/reel-editor/presentation.js');
const { createEditorHandler, digest } = await import('../server/reel-editor/service.js');
const { authorizeReelForRender } = await import('../server/reel-renderer/authorization.js');
const { renderEditorReel } = await import('../server/reel-renderer/editorRenderer.js');
const root = resolve('.tmp/reel-manager-editor-v1');
await mkdir(root, { recursive: true });
const jobId = '11111111-1111-4111-8111-111111111111', actorId = 'local-demo-manager';
const file = join(root, 'state.json'), media = [], assets = new Map();
for (let i = 1; i <= 3; i++) {
  const lines = Array.from({ length: 21 }, (_, n) => `<path d="M${n * 80} 0V1200 M0 ${n * 60}H1600"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="${['#143d53', '#245647', '#573454'][i - 1]}"/><g stroke="#8bafbd" stroke-width="2">${lines}</g><rect x="530" y="330" width="540" height="400" rx="35" fill="#b4cbd3" stroke="#ffffff" stroke-width="8"/><circle cx="800" cy="530" r="140" fill="#273a42" stroke="#f6be52" stroke-width="24"/><path d="M610 530H990 M800 340V720" stroke="#ffffff" stroke-width="12"/><g fill="#fff" font-family="DejaVu Sans" font-size="44"><text x="50" y="80">LOCAL GRID FIXTURE ${i}</text><text x="50" y="1140">1600 × 1200 · reference lines</text></g></svg>`;
  const path = join(root, `fixture-${i}.png`);
  let bytes; try { bytes = await readFile(path); } catch { bytes = await sharp(Buffer.from(svg)).png().toBuffer(); await writeFile(path, bytes); }
  assets.set(`fixture-${i}`, bytes);
  media.push({ attachmentId: `fixture-${i}`, width: 1600, height: 1200, identity: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/png', privacy: 'passed', bucket: 'local-only', path });
}
const context = { jobId, companyId: 'local-demo-company', actorId, canManage: true, media, privateValues: ['Private Customer', 'secret@example.com'], brand: { displayName: 'ServiceScope', logoAvailable: false, allowedCtas: ['See the service in focus.'] } };
let state;
try { state = JSON.parse(await readFile(file, 'utf8')); } catch {
  const draft = newDraft(jobId, media);
  draft.brief.problem = 'Inspection found a loose fitting.'; draft.brief.work = 'The fitting was secured.'; draft.brief.checks = 'The connection was inspected.';
  draft.scenes.forEach((scene, i) => { const ref = ['problem', 'work', 'checks'][i]; scene.frames = 100; scene.role = ['problem', 'process', 'supporting'][i]; scene.text.headline = draft.brief[ref]; scene.text.label = ['PROBLEM', 'PROCESS', 'DETAIL'][i]; scene.text.factRefs = [ref]; scene.text.disappear = 130; scene.motion = setMotion(scene, ['none', 'pan_left', 'zoom_in'][i], .08); scene.transition = { kind: i < 2 ? 'crossfade' : 'cut', frames: i < 2 ? 15 : 0 }; });
  draft.brand = { enabled: true, displayName: 'ServiceScope', logo: false, cta: 'See the service in focus.', frames: 60 };
  state = { row: { draft, revision: 1, brief_confirmation: null, approval: null }, snapshot: null, render: null, counts: { exports: 0, provider: 0, ai: 0 } };
  await writeFile(file, JSON.stringify(state, null, 2));
}
async function persist() { await writeFile(file, JSON.stringify(state, null, 2)); }
const client = {
  authenticate: async () => ({ token: 'local-only', userId: actorId }),
  userRpc: async () => structuredClone(context),
  select: async table => table === 'company_reel_creative_plans' ? [{ plan_json: structuredClone(state.snapshot) }] : [structuredClone(state.row)],
  downloadBounded: async (_bucket, path) => readFile(path),
  adminRpc: async (name, args) => {
    if (args.p_expected_revision !== state.row.revision) throw Object.assign(new Error('EDITOR_DRAFT_CONFLICT'), { code: 'EDITOR_DRAFT_CONFLICT' });
    if (name === 'commit_company_reel_editor_draft') {
      const captionOnly = !args.p_confirm_brief && args.p_draft.caption !== state.row.draft.caption && digest({ ...args.p_draft, caption: '' }) === digest({ ...state.row.draft, caption: '' });
      state.row = { draft: args.p_draft, revision: state.row.revision + 1, brief_confirmation: args.p_confirm_brief ? { actorId, revision: state.row.revision + 1, confirmedAt: new Date().toISOString(), confirmedBrief: structuredClone(args.p_draft.brief) } : digest(state.row.draft.brief) === digest(args.p_draft.brief) ? state.row.brief_confirmation : null, approval: captionOnly && state.row.approval ? { ...state.row.approval, draftRevision: state.row.revision + 1 } : null };
    } else if (name === 'commit_company_reel_editor_approval') {
      if (!state.row.approval) { state.snapshot = args.p_snapshot; state.row.approval = { creativePlanId: randomUUID(), revision: args.p_snapshot.revision, draftRevision: state.row.revision }; }
    } else throw new Error('LOCAL_RPC_UNSUPPORTED');
    await persist(); return structuredClone(state.row);
  },
};
const handler = createEditorHandler({ client });
let lock = false;
async function inspectMp4(videoPath, expectedDuration) {
  const executable = process.env.FFMPEG_BIN || resolve('.tmp/reel-editor-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
  const stderr = await new Promise((resolveOutput, reject) => {
    const child = spawn(executable, ['-hide_banner', '-i', videoPath, '-map', '0:v:0', '-f', 'null', '-'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }); let output = '';
    child.stderr.on('data', bytes => { output += bytes; }); child.on('error', reject); child.on('close', code => code === 0 ? resolveOutput(output) : reject(new Error('LOCAL_MP4_DECODE_FAILED')));
  });
  const duration = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationMs = duration ? Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000) : 0;
  const frames = [...stderr.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1];
  const bytes = await readFile(videoPath);
  if (!/Video: h264/.test(stderr) || !/yuv420p/.test(stderr) || !/1080x1920/.test(stderr) || !/30 fps/.test(stderr) || /Audio:/.test(stderr) || durationMs !== expectedDuration || Number(frames) !== expectedDuration / 1000 * 30 || bytes.indexOf(Buffer.from('moov')) > bytes.indexOf(Buffer.from('mdat'))) throw new Error('LOCAL_MP4_VALIDATION_FAILED');
  return { durationMs, width: 1080, height: 1920, fps: 30, videoCodec: 'h264', pixelFormat: 'yuv420p', audioStreams: 0, fileSize: bytes.length, faststart: true, videoSha256: createHash('sha256').update(bytes).digest('hex') };
}
const server = await createServer({ configFile: resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 5178, strictPort: true }, plugins: [{ name: 'local-reel-editor', configureServer(vite) {
  vite.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/__reel-editor/')) return next();
    if (!['127.0.0.1:5178', 'localhost:5178'].includes(req.headers.host) || (req.headers.origin && !['http://127.0.0.1:5178', 'http://localhost:5178'].includes(req.headers.origin))) { res.statusCode = 403; res.end(); return; }
    try {
      if (req.url === '/__reel-editor/demo.mp4' && state.render?.status === 'completed') {
        const bytes = await readFile(join(root, 'demo.mp4')); res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Accept-Ranges','bytes');
        const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        if (range) { const start=Number(range[1]), end=Math.min(bytes.length-1,range[2] ? Number(range[2]) : bytes.length-1); if(start>end){res.statusCode=416;res.end();return;} res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${bytes.length}`);res.setHeader('Content-Length',end-start+1);res.end(bytes.subarray(start,end+1)); }
        else { res.setHeader('Content-Length',bytes.length);res.end(bytes); } return;
      }
      const image = req.url.match(/^\/__reel-editor\/media\/([123])$/);
      if (image) { res.setHeader('Content-Type', 'image/png'); res.end(assets.get(`fixture-${image[1]}`)); return; }
      if (req.url !== '/__reel-editor/action' || req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      let raw = ''; for await (const bytes of req) { raw += bytes; if (raw.length > 24000) throw new Error('EDITOR_REQUEST_TOO_LARGE'); }
      const input = JSON.parse(raw);
      if (input.operation === 'render') {
        if (!state.row.approval || state.row.approval.revision !== input.approval?.revision || state.row.approval.creativePlanId !== input.approval?.creativePlanId) throw new Error('EDITOR_APPROVAL_REQUIRED');
        if (state.render?.status === 'completed') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state.render)); return; }
        if (lock || state.counts.exports >= 1) throw new Error('LOCAL_EXPORT_ALREADY_REQUESTED');
        lock = true; state.counts.exports++; state.render = { status: 'rendering', renderJobId: randomUUID() }; await persist();
        try {
          const authorized = authorizeReelForRender({ plan: state.snapshot, context });
          const output = await renderEditorReel({ authorized, stagedAssets: state.snapshot.media.map(m => ({ attachmentId: m.attachmentId, path: `${m.attachmentId}.png` })), stagingRoot: root, ffmpegBin: process.env.FFMPEG_BIN || resolve('.tmp/reel-editor-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'), validate: inspectMp4, timeoutMs: 210000 });
          await copyFile(output.videoPath, join(root, 'demo.mp4')); await copyFile(output.coverPath, join(root, 'cover.jpg'));
          state.render = { ...state.render, ...output, videoPath: undefined, coverPath: undefined, dispose: undefined, status: 'completed', videoUrl: '/__reel-editor/demo.mp4' }; await output.dispose();
          await persist();
        } catch (e) { state.render = { ...state.render, status: 'failed', code: e.message }; await persist(); throw e; } finally { lock = false; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state.render)); return;
      }
      const response = await handler(new Request('http://127.0.0.1:5178/api/reel-editor', { method: 'POST', headers: { Authorization: 'Bearer local-only' }, body: raw }));
      const value = await response.json(); if (input.operation === 'load' && response.ok) value.render = state.render;
      res.statusCode = response.status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value));
    } catch (e) { res.statusCode = 409; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code: e.message })); }
  });
} }] });
await server.listen();
console.log('Local Reel Editor: http://127.0.0.1:5178/reel-editor.html');
console.log(`Saved demo state and export: ${root}`);
