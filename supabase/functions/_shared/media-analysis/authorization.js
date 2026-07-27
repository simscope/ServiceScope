import { assertAiAssistantAccess } from '../content-engine/access.js';
import {
  maxImageBytes,
  maxTotalBytes,
  maxVideoBytes,
  supportedImageMimeTypes,
  supportedVideoMimeTypes,
} from './contracts.js';
import { httpError } from './errors.js';
import { buildKnownPrivateValues } from './privacy.js';

export async function buildAuthorizedMediaContext({ request, session, repository }) {
  const job = await repository.getJob(request.jobId);
  if (!job) throw httpError('MEDIA_NOT_FOUND');
  if (!['Completed', 'Warranty'].includes(String(job.status))) throw httpError('UNSUPPORTED_STATUS');
  const company = await repository.getCompany(job.company_id);
  if (!company) throw httpError('MEDIA_NOT_FOUND');
  const companyUser = await repository.getCompanyUser(session, company.id);
  try {
    assertAiAssistantAccess({ session, company, companyUser });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'FORBIDDEN';
    throw httpError(code);
  }
  if (String(job.company_id) !== String(company.id)) throw httpError('MEDIA_WRONG_TENANT');

  const [attachments, customer, location, invoices, comments] = await Promise.all([
    repository.listAttachmentsByIds(request.attachmentIds),
    repository.getCustomer(job.customer_id),
    repository.getLocation(job.customer_location_id),
    repository.listInvoices(company.id, job.id),
    repository.listComments(company.id, job.id),
  ]);

  const attachmentsById = new Map((attachments ?? []).map((attachment) => [String(attachment.id), attachment]));
  const selectedAttachments = request.attachmentIds.map((id) => attachmentsById.get(id));
  if (selectedAttachments.some((attachment) => !attachment)) throw httpError('MEDIA_NOT_FOUND');
  const validatedAttachments = selectedAttachments.map((attachment) => validateAttachment({ attachment, job, company }));
  const totalBytes = validatedAttachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0);
  if (totalBytes > maxTotalBytes) throw httpError('MEDIA_REQUEST_TOO_LARGE');

  return {
    jobId: String(job.id),
    companyId: String(company.id),
    actorId: actorId(session),
    status: String(job.status),
    attachments: validatedAttachments,
    privateValues: buildKnownPrivateValues([
      job.job_number,
      job.notes,
      job.service_call_fee_cents,
      job.labor_cents,
      customer?.organization,
      customer?.primary_name,
      customer?.primary_email,
      customer?.primary_phone,
      customer?.notes,
      location?.address,
      ...(invoices ?? []).flatMap((invoice) => [invoice.invoice_number, invoice.amount_cents, invoice.status]),
      ...(comments ?? []).map((comment) => comment.message),
    ]),
  };
}

export function validateAttachment({ attachment, job, company }) {
  if (!attachment) throw httpError('MEDIA_NOT_FOUND');
  if (String(attachment.company_id) !== String(company.id) || String(attachment.job_id) !== String(job.id)) {
    throw httpError('MEDIA_WRONG_TENANT');
  }
  const mimeType = String(attachment.mime_type ?? '').trim().toLowerCase();
  const mediaKind = mediaKindFor(attachment.kind, mimeType);
  if (!mediaKind) throw httpError('MEDIA_UNSUPPORTED_TYPE');
  const sizeBytes = Math.max(0, Number(attachment.size_bytes) || 0);
  if (mediaKind === 'photo' && sizeBytes > maxImageBytes) throw httpError('MEDIA_TOO_LARGE');
  if (mediaKind === 'video' && sizeBytes > maxVideoBytes) throw httpError('MEDIA_TOO_LARGE');
  if (!attachment.storage_bucket || !attachment.storage_path) throw httpError('MEDIA_NOT_FOUND');
  return {
    id: String(attachment.id),
    companyId: String(attachment.company_id),
    jobId: String(attachment.job_id),
    mediaKind,
    mimeType,
    sizeBytes,
    storageBucket: String(attachment.storage_bucket),
    storagePath: String(attachment.storage_path),
    createdAt: attachment.created_at ? String(attachment.created_at) : '',
    updatedAt: attachment.updated_at ? String(attachment.updated_at) : '',
  };
}

export function mediaKindFor(kind, mimeType) {
  const normalizedMime = String(mimeType ?? '').trim().toLowerCase();
  if (String(kind ?? '').toLowerCase() === 'photo' && supportedImageMimeTypes.has(normalizedMime)) return 'photo';
  if (supportedImageMimeTypes.has(normalizedMime)) return 'photo';
  if (supportedVideoMimeTypes.has(normalizedMime)) return 'video';
  return null;
}

function actorId(session) {
  return String(session.user_id ?? session.auth_user_id ?? session.id ?? session.email ?? 'unknown');
}

