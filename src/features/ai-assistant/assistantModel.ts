import type { JobAttachment, ServiceJob, ServiceJobStatus } from '../../types.js';

export type AssistantJobInput = Pick<
  ServiceJob,
  | 'id'
  | 'status'
  | 'system'
  | 'issue'
  | 'notes'
  | 'clientName'
  | 'organization'
  | 'phone'
  | 'email'
  | 'address'
  | 'attachments'
>;

export type AssistantSafeJobSummary = {
  jobId: string;
  status: ServiceJobStatus;
  system: string;
  description: string;
};

export const AI_ASSISTANT_SUPPORTED_STATUSES: ServiceJobStatus[] = ['Completed', 'Warranty'];

export function canOpenJobInAiAssistant(status: ServiceJobStatus) {
  return AI_ASSISTANT_SUPPORTED_STATUSES.includes(status);
}

function scrubOneValue(text: string, value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return text;

  return text.split(trimmed).join('[private]');
}

export function scrubPrivateJobValues(text: string, job: AssistantJobInput) {
  const jobNumber = (job as { jobNumber?: string }).jobNumber;

  return [
    jobNumber,
    job.clientName,
    job.organization,
    job.phone,
    job.email,
    job.address,
  ].reduce((current, value) => scrubOneValue(current, value), text);
}

export function assistantPhotoAttachments(attachments: JobAttachment[] = []) {
  return attachments.filter((attachment) => attachment.kind === 'photo');
}

export function assistantVideoAttachments(attachments: JobAttachment[] = []) {
  return attachments.filter((attachment) => /^video\//i.test(attachment.mimeType) || /\.(mov|mp4|m4v|webm)$/i.test(attachment.name));
}

export function assistantMediaCounts(job: Pick<AssistantJobInput, 'attachments'>) {
  return {
    photos: assistantPhotoAttachments(job.attachments).length,
    videos: assistantVideoAttachments(job.attachments).length,
  };
}

export function generateDeterministicAssistantDescription(job: AssistantJobInput) {
  const system = job.system?.trim() || 'Service job';
  const issue = job.issue?.trim() || 'completed service work';
  const draft = `${system}: ${issue}.`;

  return scrubPrivateJobValues(draft, job);
}

export function buildAssistantJobSummary(job: AssistantJobInput): AssistantSafeJobSummary {
  return {
    jobId: job.id,
    status: job.status,
    system: scrubPrivateJobValues(job.system?.trim() || 'Service job', job),
    description: generateDeterministicAssistantDescription(job),
  };
}
