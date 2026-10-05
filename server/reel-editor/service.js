import { createHash } from 'node:crypto';
import { assertNoPrivateValues } from '../../supabase/functions/_shared/content-engine/privacy.js';
import { editorContract, briefFields, roles, motions, draftErrors, textLayout } from '../../src/features/reel-editor/presentation.js';
import { hydrateEditorContext } from './context.js';

export class EditorError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = code => { throw new EditorError(code); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => { if (!object(value) || Object.keys(value).sort().join(',') !== expected.split(',').sort().join(',')) fail('EDITOR_INVALID_DRAFT'); };
const number = (value, min, max) => { if (!Number.isFinite(value) || value < min || value > max) fail('EDITOR_INVALID_DRAFT'); };
const integer = (value, min, max) => { number(value, min, max); if (!Number.isInteger(value)) fail('EDITOR_INVALID_DRAFT'); };
const text = (value, max) => { if (typeof value !== 'string' || value.length > max || /[<>\u0000-\u0008]/.test(value)) fail('EDITOR_INVALID_DRAFT'); };
const choice = (value, choices) => { if (!choices.includes(value)) fail('EDITOR_INVALID_DRAFT'); };
export function validateDraft(draft, context, forApproval = false) {
  keys(draft, 'contract,jobId,brief,scenes,brand,caption');
  if (draft.contract !== editorContract || draft.jobId !== context.jobId || !context.canManage || !context.actorId) fail('FORBIDDEN');
  keys(draft.brief, 'problem,work,result,checks,prohibited,language,emphasis,mediaRefs');
  for (const field of briefFields) text(draft.brief[field], 700);
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(draft.brief.language)) fail('EDITOR_INVALID_DRAFT');
  choice(draft.brief.emphasis, roles);
  if (!Array.isArray(draft.brief.mediaRefs) || draft.brief.mediaRefs.length > 8) fail('EDITOR_INVALID_DRAFT');
  if (!Array.isArray(draft.scenes) || draft.scenes.length < 1 || draft.scenes.length > 8) fail('EDITOR_INVALID_DRAFT');
  const media = new Map(context.media.map(m => [m.attachmentId, m]));
  if (draft.brief.mediaRefs.some(id => !media.has(id))) fail('EDITOR_MEDIA_STALE');
  const ids = new Set();
  for (const scene of draft.scenes) {
    keys(scene, 'id,attachmentId,role,frames,crop,motion,transition,text');
    text(scene.id, 80); if (!scene.id || ids.has(scene.id)) fail('EDITOR_INVALID_DRAFT'); ids.add(scene.id);
    choice(scene.role, roles); integer(scene.frames, 30, 300);
    const asset = media.get(scene.attachmentId);
    if (scene.attachmentId === 'brand-logo') fail('EDITOR_MEDIA_PRIVACY_REQUIRED');
    if (!asset || !asset.identity || asset.privacy !== 'passed' || !/^image\/(jpeg|png|webp)$/.test(asset.mimeType)) fail('EDITOR_MEDIA_PRIVACY_REQUIRED');
    keys(scene.crop, 'mode,scale,x,y'); choice(scene.crop.mode, ['fit', 'fill']); number(scene.crop.scale, 1, 2); number(scene.crop.x, 0, 1); number(scene.crop.y, 0, 1);
    keys(scene.motion, 'kind,intensity,start,end'); choice(scene.motion.kind, motions); number(scene.motion.intensity, 0, .2);
    for (const pose of [scene.motion.start, scene.motion.end]) { keys(pose, 'scale,x,y'); number(pose.scale, 1, 1.2); number(pose.x, 0, 1); number(pose.y, 0, 1); }
    if (scene.motion.kind === 'none' && JSON.stringify(scene.motion.start) !== JSON.stringify(scene.motion.end)) fail('EDITOR_NONE_MUST_BE_STATIC');
    keys(scene.transition, 'kind,frames'); choice(scene.transition.kind, ['cut', 'crossfade', 'fade_black']); integer(scene.transition.frames, 0, 30);
    if ((scene.transition.kind === 'cut') !== (scene.transition.frames === 0)) fail('EDITOR_INVALID_DRAFT');
    const t = scene.text;
    keys(t, 'enabled,label,headline,subline,factRefs,x,y,width,fontSize,align,color,background,backplate,appear,disappear');
    if (typeof t.enabled !== 'boolean' || typeof t.backplate !== 'boolean') fail('EDITOR_INVALID_DRAFT');
    for (const [field, max] of [['label', 40], ['headline', 180], ['subline', 240]]) text(t[field], max);
    number(t.x, .09, .7); number(t.y, .12, .72); number(t.width, .2, .77); integer(t.fontSize, 40, 80);
    choice(t.align, ['left', 'center', 'right']);
    for (const color of [t.color, t.background]) if (!/^#[0-9a-f]{6}$/i.test(color)) fail('EDITOR_INVALID_DRAFT');
    integer(t.appear, 0, scene.frames - 1); integer(t.disappear, t.appear + 1, scene.frames + 30);
    if (!Array.isArray(t.factRefs) || t.factRefs.some(f => !['problem', 'work', 'result', 'checks'].includes(f))) fail('EDITOR_INVALID_DRAFT');
    if (forApproval && t.enabled) {
      if (textLayout(t).overflow) fail('EDITOR_TEXT_OVERFLOW');
      // Every claim must be a literal excerpt of the separately confirmed brief.
      // Installed/tested/restored claims therefore cannot be inferred from photographs.
      for (const claim of [t.headline, t.subline].filter(Boolean)) {
        if (!t.factRefs.some(ref => draft.brief[ref].trim().includes(claim.trim()))) fail('EDITOR_UNCONFIRMED_CLAIM');
      }
      if (t.label && !['PROBLEM', 'PROCESS', 'SERVICE', 'DETAIL', 'RESULT', 'MAINTENANCE', 'FIELD NOTE'].includes(t.label)) fail('EDITOR_UNCONFIRMED_CLAIM');
    }
  }
  keys(draft.brand, 'enabled,displayName,logo,cta,frames');
  if (typeof draft.brand.enabled !== 'boolean' || typeof draft.brand.logo !== 'boolean') fail('EDITOR_INVALID_DRAFT');
  text(draft.brand.displayName, 60); text(draft.brand.cta, 90); integer(draft.brand.frames, 30, 150);
  if (draft.brand.enabled && (draft.brand.displayName !== context.brand.displayName || (draft.brand.logo && !context.brand.logoAvailable) || (draft.brand.cta && !context.brand.allowedCtas.includes(draft.brand.cta)))) fail('EDITOR_BRAND_NOT_AUTHORIZED');
  text(draft.caption, 2000);
  if (forApproval) {
    const output = [...draft.scenes.filter(s => s.text.enabled).flatMap(s => [s.text.label,s.text.headline,s.text.subline]),draft.brand.enabled ? draft.brand.cta : '',draft.caption].join('\n').normalize('NFKC').toLowerCase();
    if (draft.brief.prohibited.split('\n').map(line => line.trim().normalize('NFKC').toLowerCase()).filter(line => line.length > 1).some(line => output.includes(line))) fail('EDITOR_PROHIBITED_CLAIM');
  }
  try { assertNoPrivateValues([draft.brief, draft.scenes.map(s => s.text), draft.caption, draft.brand.cta], context.privateValues); }
  catch { fail('REEL_PRIVACY_FAILED'); }
  if (forApproval && draftErrors(draft).length) fail('EDITOR_BRIEF_OR_LAYOUT_REQUIRED');
  return structuredClone(draft);
}
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value; }
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function approvedSnapshot(draft, row, context) {
  validateDraft(draft, context, true);
  if (!row.briefConfirmation || digest(row.briefConfirmation.confirmedBrief) !== digest(draft.brief)) fail('EDITOR_BRIEF_CONFIRMATION_REQUIRED');
  const media = draft.scenes.map(s => context.media.find(m => m.attachmentId === s.attachmentId)).map(m => ({ attachmentId: m.attachmentId, identity: m.identity, width: m.width, height: m.height, mimeType: m.mimeType, privacy: m.privacy }));
  if (draft.brand.enabled && draft.brand.logo) media.push(context.media.find(m => m.attachmentId === 'brand-logo'));
  const uniqueMedia = [...new Map(media.map(m => [m.attachmentId, m])).values()];
  const renderDraft = structuredClone(draft); renderDraft.caption = '';
  const snapshot = { schemaVersion: 'reel-manager-plan-v2', decision: 'create_reel', draft: renderDraft, media: uniqueMedia,
    briefAuthority: structuredClone(row.briefConfirmation), contract: editorContract, draftRevision: row.revision };
  return { ...snapshot, revision: `reel-editor-v2-${digest(snapshot)}` };
}
export function assertSnapshotCurrent(snapshot, context) {
  const { revision, snapshotHash, ...body } = snapshot;
  if ((snapshot.renderOnly ? snapshotHash !== digest(body) : revision !== `reel-editor-v2-${digest(body)}`) || snapshot.contract !== editorContract) fail('EDITOR_SNAPSHOT_INVALID');
  if (snapshot.renderOnly && (snapshot.draft.caption || snapshot.draft.brief.prohibited || snapshot.draft.brief.mediaRefs.length)) fail('EDITOR_SNAPSHOT_INVALID');
  if (!snapshot.briefAuthority?.actorId || !snapshot.briefAuthority?.confirmedAt || digest(snapshot.briefAuthority.confirmedBrief) !== digest(snapshot.draft.brief)) fail('EDITOR_BRIEF_CONFIRMATION_REQUIRED');
  validateDraft(snapshot.draft, context, true);
  for (const asset of snapshot.media) {
    const current = context.media.find(m => m.attachmentId === asset.attachmentId);
    if (!current || current.identity !== asset.identity || current.width !== asset.width || current.height !== asset.height || current.privacy !== 'passed') fail('EDITOR_MEDIA_STALE');
  }
  return snapshot;
}
export function sanitizeEditorAuthority(authority) {
  assertSnapshotCurrent(authority.plan, authority.context);
  const plan = structuredClone(authority.plan);
  plan.renderOnly = true; plan.draft.caption = ''; plan.draft.brief.prohibited = ''; plan.draft.brief.mediaRefs = [];
  plan.briefAuthority.confirmedBrief = structuredClone(plan.draft.brief);
  const { revision, ...body } = plan;
  plan.snapshotHash = digest(body);
  const context = { jobId: authority.context.jobId, actorId: authority.context.actorId, canManage: true,
    media: structuredClone(plan.media), brand: { displayName: authority.context.brand.displayName, logoAvailable: authority.context.brand.logoAvailable, allowedCtas: authority.context.brand.allowedCtas }, privateValues: [] };
  return { plan, context };
}
export function createEditorHandler({ client }) {
  return async request => {
    try {
      if (request.method !== 'POST') throw new EditorError('METHOD_NOT_ALLOWED', 405);
      if (Number(request.headers.get('content-length') || 0) > 24000) throw new EditorError('EDITOR_REQUEST_TOO_LARGE', 413);
      const session = await client.authenticate(request.headers.get('authorization') || '');
      const raw = await request.text(); if (Buffer.byteLength(raw) > 24000) throw new EditorError('EDITOR_REQUEST_TOO_LARGE', 413);
      let input; try { input = JSON.parse(raw); } catch { throw new EditorError('EDITOR_INVALID_REQUEST', 400); }
      if (!object(input) || !/^[0-9a-f-]{36}$/i.test(input.jobId)) throw new EditorError('EDITOR_INVALID_REQUEST', 400);
      const context = await client.userRpc('get_company_reel_editor_context', { p_job_id: input.jobId }, session.token);
      if (!context || context.actorId !== session.userId || !context.canManage) fail('FORBIDDEN');
      const rows = await client.select('company_reel_editor_drafts', `select=*&job_id=eq.${input.jobId}&company_id=eq.${context.companyId}&limit=1`);
      const row = rows?.[0] ?? null;
      if (input.operation !== 'load' && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (row?.revision ?? 0))) fail('EDITOR_DRAFT_CONFLICT');
      const selectedIds = input.operation === 'save' ? input.draft?.scenes?.map(s => s.attachmentId) : row?.draft?.scenes?.map(s => s.attachmentId);
      await hydrateEditorContext(client, context, selectedIds ?? context.media.slice(0, 8).map(m => m.attachmentId));
      let approvalApplicable = true, approvalError = null;
      if (row?.approval) {
        const approvedRows = await client.select('company_reel_creative_plans', `select=plan_json&id=eq.${row.approval.creativePlanId}&job_id=eq.${input.jobId}&company_id=eq.${context.companyId}&limit=1`);
        try { assertSnapshotCurrent(approvedRows?.[0]?.plan_json, context); } catch (e) { approvalApplicable = false; approvalError = e.code || 'EDITOR_SNAPSHOT_INVALID'; }
      }
      if (input.operation === 'load') {
        const logo = context.brand.logoAvailable ? await client.sign(context.brand.logoBucket, context.brand.logoPath, 300) : null;
        return Response.json({ row: row ? { ...row, approvalApplicable, approvalError } : null, brand: { displayName: context.brand.displayName, logoAvailable: context.brand.logoAvailable, allowedCtas: context.brand.allowedCtas }, media: context.media.map(({ attachmentId, identity, width, height, mimeType, privacy }) => ({ attachmentId, identity, width, height, mimeType, privacy, ...(attachmentId === 'brand-logo' ? { url: logo.signedURL, name: 'Approved company logo' } : {}) })) });
      }
      if (input.operation === 'save') {
        const draft = validateDraft(input.draft, context);
        const result = await client.adminRpc('commit_company_reel_editor_draft', { p_job_id: input.jobId, p_actor_id: session.userId, p_expected_revision: input.expectedRevision, p_draft: draft, p_confirm_brief: input.confirmBrief === true });
        return Response.json({ row: { ...result, approvalApplicable: result.approval ? approvalApplicable : true, approvalError: result.approval ? approvalError : null } });
      }
      if (input.operation === 'approve' && row) {
        if (row.approval && !approvalApplicable) fail(approvalError);
        const snapshot = approvedSnapshot(row.draft, { revision: row.revision, briefConfirmation: row.brief_confirmation }, context);
        const result = await client.adminRpc('commit_company_reel_editor_approval', { p_job_id: input.jobId, p_actor_id: session.userId, p_expected_revision: row.revision, p_snapshot: snapshot });
        return Response.json({ row: result });
      }
      fail('EDITOR_INVALID_REQUEST');
    } catch (error) {
      return Response.json({ code: error instanceof EditorError ? error.code : error?.code || 'EDITOR_SERVICE_UNAVAILABLE' }, { status: error instanceof EditorError ? error.status : 409, headers: { 'Cache-Control': 'no-store' } });
    }
  };
}
