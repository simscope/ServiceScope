import { supabaseFunction } from '../../services/supabaseRest';
import type { FacebookPublishingSnapshot, FacebookPublishResult } from './contracts';

const functionName = 'meta-social-publish';

export function loadFacebookPublishingStatus(companyId: string, jobId?: string) {
  return supabaseFunction<FacebookPublishingSnapshot>(functionName, {
    action: 'status',
    companyId,
    ...(jobId ? { jobId } : {}),
  });
}

export function publishFacebookText(input: {
  companyId: string;
  jobId: string;
  message: string;
  idempotencyKey: string;
  explicitApproval: true;
}) {
  return supabaseFunction<FacebookPublishResult>(functionName, {
    action: 'publish_facebook_text',
    ...input,
  }, { timeoutMs: 20_000 });
}

export function approveFacebookPublicationPhoto(input: {
  companyId: string;
  jobId: string;
  attachmentId: string;
  explicitApproval: true;
  approvalReason?: string;
}) {
  return supabaseFunction<{ ok: true; attachmentId: string; approvalStatus: 'approved'; approvedAt: string | null }>(functionName, {
    action: 'approve_facebook_publication_photo',
    ...input,
  }, { timeoutMs: 20_000 });
}

export function revokeFacebookPublicationPhotoApproval(input: {
  companyId: string;
  jobId: string;
  attachmentId: string;
  explicitApproval: true;
  revocationReason?: string;
}) {
  return supabaseFunction<{ ok: true; attachmentId: string; approvalStatus: 'revoked'; revokedAt: string | null }>(functionName, {
    action: 'revoke_facebook_publication_photo_approval',
    ...input,
  }, { timeoutMs: 20_000 });
}

export function publishFacebookSinglePhoto(input: {
  companyId: string;
  jobId: string;
  attachmentId: string;
  message: string;
  idempotencyKey: string;
  explicitApproval: true;
}) {
  return supabaseFunction<FacebookPublishResult>(functionName, {
    action: 'publish_facebook_single_photo',
    ...input,
  }, { timeoutMs: 20_000 });
}
