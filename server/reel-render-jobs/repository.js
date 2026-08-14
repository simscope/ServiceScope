import { createHash } from 'node:crypto';
import { buildAuthorizedContext } from '../../supabase/functions/_shared/content-engine/context.js';
import { sha256DigestsEqual } from '../../supabase/functions/_shared/media-analysis/checksum.js';
import { buildReelContext } from '../../supabase/functions/_shared/reel-engine/director.js';
import { reelRenderMaxMediaBytes, reelWorkerLeaseSeconds, RenderJobError } from './contracts.js';

export function createRenderRepository(client) {
  return {
    async claim(renderJobId) {
      const rows = await client.adminRpc('claim_company_reel_render_job', {
        p_render_job_id: renderJobId,
        p_lease_seconds: reelWorkerLeaseSeconds,
      });
      return Array.isArray(rows) ? rows[0] ?? null : null;
    },
    async status(renderJobId) {
      const rows = await client.select('company_reel_render_jobs', `select=id,status&id=eq.${encodeURIComponent(renderJobId)}&limit=1`);
      return rows?.[0]?.status ?? null;
    },
    async loadAuthority(claim) {
      const planRows = await client.select('company_reel_creative_plans', `select=*&id=eq.${encodeURIComponent(claim.creative_plan_id)}&company_id=eq.${claim.company_id}&job_id=eq.${claim.job_id}&limit=1`);
      const planRow = planRows?.[0];
      if (!planRow) throw new RenderJobError('REEL_RENDER_CONTEXT_STALE', 409);
      const assets = new Map();
      const repository = contextRepository(client, assets);
      const session = await ownerSession(client, claim.company_id, planRow.created_by);
      const request = {
        jobId: claim.job_id,
        locale: planRow.locale,
        localFacts: planRow.local_facts,
        mediaPlan: planRow.media_plan,
        planningRevision: planRow.planning_revision,
      };
      const base = await buildAuthorizedContext({
        request: {
          jobId: request.jobId, channel: 'Short Video', localFacts: request.localFacts,
          mediaState: request.mediaPlan.map((item) => ({ id: item.attachmentId, selected: true, order: item.position - 1 })),
        },
        session,
        repository,
      });
      const context = await buildReelContext(request, base, repository);
      return { plan: planRow.plan_json, context, assets };
    },
    complete(renderJobId, leaseToken, paths, metadata) {
      return client.adminRpc('complete_company_reel_render_job', {
        p_render_job_id: renderJobId, p_lease_token: leaseToken,
        p_output_bucket: paths.bucket, p_video_object_path: paths.video, p_cover_object_path: paths.cover,
        p_duration_ms: metadata.durationMs, p_width: metadata.width, p_height: metadata.height, p_fps: metadata.fps,
        p_video_codec: metadata.videoCodec, p_pixel_format: metadata.pixelFormat,
        p_audio_streams: metadata.audioStreams, p_file_size: metadata.fileSize, p_faststart: metadata.faststart,
      });
    },
    fail(renderJobId, leaseToken, errorCode) {
      return client.adminRpc('fail_company_reel_render_job', {
        p_render_job_id: renderJobId, p_lease_token: leaseToken, p_error_code: errorCode,
      });
    },
    release(renderJobId, leaseToken) {
      return client.adminRpc('release_company_reel_render_job_for_retry', {
        p_render_job_id: renderJobId, p_lease_token: leaseToken,
      });
    },
    upload: client.upload,
  };
}

function contextRepository(client, assets) {
  return {
    getJob: (id) => one(client, 'jobs', `select=id,company_id,job_number,status,system,issue,notes,service_call_fee_cents,labor_cents,customer_id,customer_location_id&id=eq.${id}`),
    getCompany: async (id) => {
      const company = await one(client, 'companies', `select=id,owner_email&id=eq.${id}`);
      const profile = await one(client, 'company_profiles', `select=access_rules&company_id=eq.${id}`);
      return company ? { ...company, access_rules: profile?.access_rules ?? {} } : null;
    },
    getCompanyUser: async () => null,
    getCompanyVoiceSettings: (id) => one(client, 'company_profiles', `select=ai_voice_enabled,ai_public_display_name,ai_default_tone,ai_custom_voice_guidance,ai_service_areas,ai_public_location_wording,ai_cta_guidance,ai_hashtag_guidance,ai_channel_defaults&company_id=eq.${id}`),
    getCustomer: (id) => id ? one(client, 'customers', `select=organization,primary_name,primary_email,primary_phone,notes&id=eq.${id}`) : null,
    getLocation: (id) => id ? one(client, 'customer_locations', `select=address&id=eq.${id}`) : null,
    listMaterials: (companyId, jobId) => many(client, 'job_materials', `select=id,company_id,job_id,name,status&company_id=eq.${companyId}&job_id=eq.${jobId}&limit=200`),
    listAttachments: (companyId, jobId) => many(client, 'job_attachments', `select=id,company_id,job_id,name,mime_type,kind,created_at&company_id=eq.${companyId}&job_id=eq.${jobId}&limit=200`),
    listInvoices: (companyId, jobId) => many(client, 'job_invoices', `select=invoice_number,amount_cents,status&company_id=eq.${companyId}&job_id=eq.${jobId}&limit=50`),
    listComments: (companyId, jobId) => many(client, 'job_comments', `select=message&company_id=eq.${companyId}&job_id=eq.${jobId}&limit=200`),
    async listReelMediaCandidates(companyId, jobId, attachmentIds) {
      const rows = await client.adminRpc('list_company_reel_media_analysis_candidates', {
        p_company_id: companyId, p_job_id: jobId, p_attachment_ids: attachmentIds,
      });
      const byId = new Map();
      for (const row of rows ?? []) {
        if (byId.has(row.attachment_id)) continue;
        const bytes = await client.downloadBounded(row.storage_bucket, row.storage_path, reelRenderMaxMediaBytes);
        if (!bytes.length) throw new RenderJobError('REEL_RENDER_CONTEXT_STALE', 409);
        const checksum = `\\x${createHash('sha256').update(bytes).digest('hex')}`;
        byId.set(row.attachment_id, { bytes, checksum });
        assets.set(row.attachment_id, bytes);
      }
      return (rows ?? []).map((row) => ({
        ...row,
        current_checksum_matches: sha256DigestsEqual(byId.get(row.attachment_id)?.checksum, row.attachment_sha256),
        storage_bucket: undefined,
        storage_path: undefined,
      }));
    },
  };
}

async function ownerSession(client, companyId, authUserId) {
  const company = await one(client, 'companies', `select=owner_email&id=eq.${companyId}`);
  if (!company?.owner_email) throw new RenderJobError('REEL_RENDER_CONTEXT_STALE', 409);
  return { kind: 'company', company_id: companyId, email: company.owner_email, user_id: authUserId, auth_user_id: authUserId };
}

async function one(client, table, query) {
  const rows = await client.select(table, `${query}&limit=1`);
  return rows?.[0] ?? null;
}

async function many(client, table, query) {
  return await client.select(table, query) ?? [];
}
