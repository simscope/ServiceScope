import { MetaPublishingError } from './contracts.js';
import { ScheduledWorkerError } from './scheduledWorker.js';

const CLAIMED_PUBLICATION_COLUMNS = [
  'id', 'company_id', 'connection_id', 'job_id', 'status', 'approved_message', 'message_sha256',
  'publication_kind', 'attachment_id', 'safe_mime_type', 'approved_by', 'scheduled_attachment_sha256',
  'scheduled_analysis_run_id', 'scheduled_attachment_result_id', 'scheduled_approval_id',
  'scheduled_facebook_page_id', 'scheduled_by_name', 'scheduled_by_role', 'claim_token', 'claim_expires_at',
].join(',');

export function createScheduledPublishingRepository(adminClient) {
  return {
    async reconcileStale(limit) {
      const { data, error } = await adminClient.rpc('reconcile_stale_scheduled_company_facebook_publications', {
        p_limit: limit,
      });
      if (error || !Number.isInteger(data) || data < 0 || data > limit) throw transientFailure();
      return data;
    },

    async claimDue(leaseSeconds, limit) {
      const { data, error } = await adminClient.rpc('claim_due_company_facebook_publications', {
        p_lease_seconds: leaseSeconds,
        p_limit: limit,
      });
      if (error || !Array.isArray(data) || data.length > limit) throw transientFailure();
      return data;
    },

    async getClaimedPublication(input) {
      const { data, error } = await adminClient
        .from('company_social_publications')
        .select(CLAIMED_PUBLICATION_COLUMNS)
        .eq('id', input.publicationId)
        .eq('company_id', input.companyId)
        .eq('status', 'scheduled')
        .eq('claim_token', input.claimToken)
        .maybeSingle();
      if (error) throw transientFailure();
      return data;
    },

    async getPublicationState(publicationId, companyId) {
      const { data, error } = await adminClient
        .from('company_social_publications')
        .select('status')
        .eq('id', publicationId)
        .eq('company_id', companyId)
        .maybeSingle();
      if (error) throw transientFailure();
      return data?.status ?? null;
    },

    async getExactConnection(input) {
      const { data, error } = await adminClient
        .from('company_social_connections')
        .select('id,company_id,provider,status,facebook_page_id,granted_scopes,token_envelope')
        .eq('id', input.connectionId)
        .eq('company_id', input.companyId)
        .eq('provider', 'meta-facebook-login')
        .maybeSingle();
      if (error) throw transientFailure();
      return data;
    },

    async getPrivacyContext(companyId, jobId) {
      const { data: job, error: jobError } = await adminClient
        .from('jobs')
        .select('id,company_id,job_number,status,notes,service_call_fee_cents,labor_cents,customer_id,customer_location_id')
        .eq('id', jobId)
        .eq('company_id', companyId)
        .maybeSingle();
      if (jobError) throw transientFailure();
      if (!job) return null;
      const [customerResult, locationResult, invoiceResult, commentResult] = await Promise.all([
        job.customer_id
          ? adminClient.from('customers').select('organization,primary_name,primary_email,primary_phone,notes').eq('id', job.customer_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        job.customer_location_id
          ? adminClient.from('customer_locations').select('address').eq('id', job.customer_location_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        adminClient.from('job_invoices').select('invoice_number,amount_cents,status').eq('company_id', companyId).eq('job_id', jobId).limit(50),
        adminClient.from('job_comments').select('message').eq('company_id', companyId).eq('job_id', jobId).limit(200),
      ]);
      if ([customerResult, locationResult, invoiceResult, commentResult].some((result) => result.error)) {
        throw transientFailure();
      }
      return {
        job,
        customer: customerResult.data,
        location: locationResult.data,
        invoices: invoiceResult.data ?? [],
        comments: commentResult.data ?? [],
      };
    },

    async getExactAttachment(input) {
      const { data, error } = await adminClient
        .from('job_attachments')
        .select('id,company_id,job_id,name,mime_type,size_bytes,kind,storage_bucket,storage_path,created_at')
        .eq('id', input.attachmentId)
        .eq('company_id', input.companyId)
        .eq('job_id', input.jobId)
        .maybeSingle();
      if (error) throw transientFailure();
      return data;
    },

    async getExactApproval(input) {
      const { data, error } = await adminClient
        .from('company_social_publication_media_approvals')
        .select('id,company_id,job_id,attachment_id,analysis_run_id,approved_at')
        .eq('id', input.approvalId)
        .eq('company_id', input.companyId)
        .eq('job_id', input.jobId)
        .eq('attachment_id', input.attachmentId)
        .maybeSingle();
      if (error) throw transientFailure();
      return data;
    },

    async downloadAttachmentBytes(input) {
      const bucket = String(input.storageBucket ?? '');
      const path = String(input.storagePath ?? '');
      const maxBytes = Number(input.maxBytes) || 0;
      if (!bucket || !path || maxBytes < 1) throw new MetaPublishingError('META_PUBLICATION_MEDIA_REQUIRED');
      const { data, error } = await adminClient.storage.from(bucket).download(path);
      if (error || !data) throw transientFailure();
      if (data.size < 1 || data.size > maxBytes) throw new MetaPublishingError('META_PUBLICATION_MEDIA_TOO_LARGE');
      return new Uint8Array(await data.arrayBuffer());
    },

    async startScheduled(input) {
      return scheduledRpcRow(adminClient, 'start_scheduled_company_facebook_publication', rpcIdentity(input), 'start');
    },

    async failPreflight(input) {
      return scheduledRpcRow(adminClient, 'fail_scheduled_company_facebook_publication_preflight', rpcIdentity(input), 'claim');
    },

    async releaseClaim(input) {
      return scheduledRpcRow(adminClient, 'release_scheduled_company_facebook_publication_claim', {
        ...rpcIdentity(input),
        p_next_attempt_at: input.nextAttemptAt,
      }, 'claim');
    },

    async completePublication(input) {
      return terminalRpcRow(adminClient, 'complete_company_facebook_publication', {
        ...terminalParams(input),
        p_provider_post_id: input.providerPostId,
        p_provider_media_id: input.providerMediaId,
      });
    },

    async failPublication(input) {
      const diagnostic = input.diagnostic ?? {};
      return terminalRpcRow(adminClient, 'fail_company_facebook_publication', {
        ...terminalParams(input),
        p_provider_http_status: diagnostic.providerHttpStatus ?? null,
        p_provider_error_code: diagnostic.providerCode ?? null,
        p_provider_error_subcode: diagnostic.providerSubcode ?? null,
        p_provider_error_category: diagnostic.providerCategory ?? 'PROVIDER_REJECTED',
        p_provider_is_transient: diagnostic.providerIsTransient ?? null,
        p_last_error_code: input.lastErrorCode,
      });
    },

    async markUnknown(input) {
      return terminalRpcRow(adminClient, 'mark_company_facebook_publication_unknown', terminalParams(input));
    },
  };
}

function rpcIdentity(input) {
  return {
    p_publication_id: input.publicationId,
    p_company_id: input.companyId,
    p_claim_token: input.claimToken,
  };
}

function terminalParams(input) {
  return {
    p_publication_id: input.publicationId,
    p_company_id: input.companyId,
    p_actor_id: input.actorAuthUserId,
    p_actor_name: input.actorName,
    p_actor_role: input.actorRole,
    p_publication_audit_metadata: input.publicationAuditMetadata ?? {},
    p_timestamp: input.timestamp,
  };
}

async function scheduledRpcRow(client, name, params, mode) {
  const { data, error } = await client.rpc(name, params);
  const row = Array.isArray(data) ? data[0] : null;
  if (!error && row) return row;
  const message = typeof error?.message === 'string' ? error.message : '';
  if (mode === 'start' && /scheduled publication (?:job|connection|attachment|media evidence|approval) unavailable|scheduled publication privacy finding unresolved/.test(message)) {
    throw new ScheduledWorkerError('SCHEDULED_DB_REVALIDATION_FAILED', 'permanent');
  }
  if (/invalid scheduled publication (?:start|claim release|preflight failure)/.test(message)) {
    throw new ScheduledWorkerError('SCHEDULED_CLAIM_LOST', 'claim_lost');
  }
  throw transientFailure();
}

async function terminalRpcRow(client, name, params) {
  const { data, error } = await client.rpc(name, params);
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) throw transientFailure();
  return row;
}

function transientFailure() {
  return new ScheduledWorkerError('SCHEDULED_INFRASTRUCTURE_ERROR', 'transient');
}
