import type { JobAttachment, MaterialRow, ServiceJob, ServiceJobStatus } from '../../types.js';

export type AssistantJobInput = Pick<
  ServiceJob,
  | 'id'
  | 'jobNumber'
  | 'status'
  | 'system'
  | 'issue'
  | 'notes'
  | 'clientName'
  | 'organization'
  | 'phone'
  | 'email'
  | 'address'
  | 'serviceCallFee'
  | 'scfPayment'
  | 'labor'
  | 'laborPayment'
  | 'attachments'
  | 'comments'
  | 'invoices'
>;

export type AssistantSafeJobSummary = {
  jobId: string;
  status: ServiceJobStatus;
  system: string;
  description: string;
};

export type AssistantEvidenceSource =
  | 'Job issue'
  | 'Technician-entered fact'
  | 'Installed material'
  | 'Attachment metadata';

export type AssistantClaim = {
  id: string;
  label: string;
  text: string;
  source: AssistantEvidenceSource;
};

export type AssistantLocalFacts = {
  diagnosis?: string;
  repairPerformed?: string;
  finalResult?: string;
};

export type AssistantMediaLabel = 'Overview' | 'Problem' | 'Repair' | 'Part' | 'Result';

export type AssistantMediaState = {
  id: string;
  selected?: boolean;
  order?: number;
  label?: AssistantMediaLabel;
};

export type AssistantMediaItem = {
  id: string;
  name: string;
  mimeType: string;
  kind: JobAttachment['kind'];
  uploadedAt: string;
  dataUrl?: string;
  selected: boolean;
  order: number;
  label?: AssistantMediaLabel;
};

export type AssistantPublicSafeContext = {
  systemEquipment?: AssistantClaim;
  complaint?: AssistantClaim;
  diagnosis?: AssistantClaim;
  repairPerformed?: AssistantClaim;
  finalResult?: AssistantClaim;
  installedMaterials: AssistantClaim[];
  media: AssistantMediaItem[];
};

export type AssistantJobContext = {
  jobId: string;
  status: ServiceJobStatus;
  publicSafe: AssistantPublicSafeContext;
  privateValues: string[];
  privateFieldNames: string[];
  missingInformation: string[];
};

export type AssistantChannel =
  | 'Instagram'
  | 'Facebook'
  | 'LinkedIn'
  | 'Google Business'
  | 'Blog / Case Study'
  | 'Short Video';

export type AssistantChannelDraft = {
  channel: AssistantChannel;
  title: string;
  body: string;
  claims: AssistantClaim[];
};

export type AssistantDraftTextState = Partial<Record<AssistantChannel, string>>;
export type AssistantDraftStatus = 'generated' | 'edited';
export type AssistantDraftStatusState = Partial<Record<AssistantChannel, AssistantDraftStatus>>;

export type AssistantDraftWorkspaceState = {
  drafts: AssistantDraftTextState;
  statuses: AssistantDraftStatusState;
};

export const AI_ASSISTANT_SUPPORTED_STATUSES: ServiceJobStatus[] = ['Completed', 'Warranty'];

export const ASSISTANT_CHANNELS: AssistantChannel[] = [
  'Instagram',
  'Facebook',
  'LinkedIn',
  'Google Business',
  'Blog / Case Study',
  'Short Video',
];

export function canOpenJobInAiAssistant(status: ServiceJobStatus) {
  return AI_ASSISTANT_SUPPORTED_STATUSES.includes(status);
}

function scrubOneValue(text: string, value?: string | number | null) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return text;

  return text.replace(new RegExp(escapeRegExp(trimmed), 'gi'), '[private]');
}

function uniqueValues(values: Array<string | number | undefined | null>) {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));
}

export function scrubPrivateJobValues(text: string, job: AssistantJobInput) {
  return privateValuesForJob(job).reduce((current, value) => scrubOneValue(current, value), text);
}

export function scrubAssistantText(text: string, context: Pick<AssistantJobContext, 'privateValues'>) {
  return context.privateValues.reduce((current, value) => scrubOneValue(current, value), text);
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
  const issue = job.issue?.trim() || 'documented service request';
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

export function buildAssistantJobContext(
  job: AssistantJobInput,
  materials: MaterialRow[] = [],
  localFacts: AssistantLocalFacts = {},
  mediaState: AssistantMediaState[] = [],
): AssistantJobContext {
  const contextBase = {
    jobId: job.id,
    status: job.status,
    privateValues: privateValuesForJob(job),
    privateFieldNames: [
      'clientName',
      'organization',
      'phone',
      'email',
      'address',
      'jobNumber',
      'prices',
      'payments',
      'invoices',
      'notes',
      'comments',
    ],
  };
  const stateById = new Map(mediaState.map((item, index) => [item.id, { ...item, order: item.order ?? index }]));
  const media = [...assistantPhotoAttachments(job.attachments), ...assistantVideoAttachments(job.attachments)]
    .map((attachment, index): AssistantMediaItem => {
      const state = stateById.get(attachment.id);
      return {
        id: attachment.id,
        name: scrubAssistantText(attachment.name, contextBase),
        mimeType: attachment.mimeType,
        kind: attachment.kind,
        uploadedAt: attachment.uploadedAt,
        dataUrl: attachment.dataUrl,
        selected: state?.selected ?? true,
        order: state?.order ?? index,
        label: state?.label,
      };
    })
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  const installedMaterials = materials
    .filter((material) => material.jobNumber === job.jobNumber && material.status === 'Installed' && material.name.trim())
    .map((material, index): AssistantClaim => ({
      id: `installed-material-${index}`,
      label: 'Installed material',
      text: scrubAssistantText(material.name.trim(), contextBase),
      source: 'Installed material',
    }));
  const diagnosis = cleanLocalFact(localFacts.diagnosis, contextBase);
  const repairPerformed = cleanLocalFact(localFacts.repairPerformed, contextBase);
  const finalResult = cleanLocalFact(localFacts.finalResult, contextBase);

  return {
    ...contextBase,
    publicSafe: {
      systemEquipment: makeClaim('system-equipment', 'System/equipment', job.system, 'Job issue', contextBase),
      complaint: makeClaim('complaint', 'Complaint/issue', job.issue, 'Job issue', contextBase),
      diagnosis: diagnosis ? { id: 'diagnosis', label: 'Diagnosis', text: diagnosis, source: 'Technician-entered fact' } : undefined,
      repairPerformed: repairPerformed
        ? { id: 'repair-performed', label: 'Repair performed', text: repairPerformed, source: 'Technician-entered fact' }
        : undefined,
      finalResult: finalResult ? { id: 'final-result', label: 'Final result', text: finalResult, source: 'Technician-entered fact' } : undefined,
      installedMaterials,
      media,
    },
    missingInformation: [
      diagnosis ? '' : 'Diagnosis missing',
      repairPerformed ? '' : 'Repair performed missing',
      finalResult ? '' : 'Final result missing',
    ].filter(Boolean),
  };
}

export function buildAssistantChannelDrafts(context: AssistantJobContext): AssistantChannelDraft[] {
  return ASSISTANT_CHANNELS.map((channel) => buildChannelDraft(channel, context));
}

export function buildAssistantExportText(drafts: AssistantChannelDraft[], context: AssistantJobContext) {
  return scrubAssistantText(
    drafts.map((draft) => `${draft.channel}\n${draft.body}`).join('\n\n---\n\n'),
    context,
  );
}

export function hydrateAssistantDraftState(
  generatedDrafts: AssistantChannelDraft[],
  currentDrafts: AssistantDraftTextState = {},
  currentStatuses: AssistantDraftStatusState = {},
): AssistantDraftWorkspaceState {
  return generatedDrafts.reduce<AssistantDraftWorkspaceState>((next, draft) => {
    const status = currentStatuses[draft.channel];
    if (status === 'edited') {
      next.drafts[draft.channel] = currentDrafts[draft.channel] ?? draft.body;
      next.statuses[draft.channel] = 'edited';
      return next;
    }

    next.drafts[draft.channel] = draft.body;
    next.statuses[draft.channel] = 'generated';
    return next;
  }, { drafts: { ...currentDrafts }, statuses: { ...currentStatuses } });
}

export function regenerateAssistantChannelDraft(
  channel: AssistantChannel,
  generatedDrafts: AssistantChannelDraft[],
  currentDrafts: AssistantDraftTextState = {},
  currentStatuses: AssistantDraftStatusState = {},
) {
  const generated = generatedDrafts.find((draft) => draft.channel === channel);
  if (!generated) return { drafts: currentDrafts, statuses: currentStatuses, regenerated: false };

  return {
    drafts: { ...currentDrafts, [channel]: generated.body },
    statuses: { ...currentStatuses, [channel]: 'generated' as const },
    regenerated: true,
  };
}

export function regenerateUneditedAssistantDrafts(
  generatedDrafts: AssistantChannelDraft[],
  currentDrafts: AssistantDraftTextState = {},
  currentStatuses: AssistantDraftStatusState = {},
) {
  return generatedDrafts.reduce<AssistantDraftWorkspaceState & { regenerated: number }>((next, draft) => {
    if (currentStatuses[draft.channel] === 'edited') return next;
    next.drafts[draft.channel] = draft.body;
    next.statuses[draft.channel] = 'generated';
    next.regenerated += 1;
    return next;
  }, { drafts: { ...currentDrafts }, statuses: { ...currentStatuses }, regenerated: 0 });
}

function buildChannelDraft(channel: AssistantChannel, context: AssistantJobContext): AssistantChannelDraft {
  const claims = orderedClaims(context);
  const body = channelBody(channel, context, claims);

  return {
    channel,
    title: channel,
    body: scrubAssistantText(body, context),
    claims,
  };
}

function channelBody(channel: AssistantChannel, context: AssistantJobContext, claims: AssistantClaim[]) {
  const { publicSafe } = context;
  const system = publicSafe.systemEquipment?.text;
  const complaint = publicSafe.complaint?.text;
  const diagnosis = publicSafe.diagnosis?.text;
  const repair = publicSafe.repairPerformed?.text;
  const result = publicSafe.finalResult?.text;
  const materials = publicSafe.installedMaterials.map((material) => material.text);
  const mediaLine = selectedMediaClaim(context)?.text;

  if (channel === 'Instagram') {
    return [
      `Hook: ${system ? `Service update for ${system}.` : 'Service update from the field.'}`,
      complaint ? `Story: Reported issue: ${complaint}.` : '',
      diagnosis ? `Finding: ${diagnosis}.` : '',
      repair ? `Work: ${repair}.` : '',
      materials.length ? `Parts: ${materials.join(', ')}.` : '',
      result ? `Result: ${result}.` : '',
      mediaLine ? `Media: ${mediaLine}.` : '',
      'CTA: Need documented service support? Reach out to schedule a visit.',
      'Hashtags: #ServiceUpdate #FieldService #Maintenance',
    ].filter(Boolean).join('\n');
  }

  if (channel === 'Facebook') {
    return [
      system ? `Service story: our team documented work for ${system}.` : 'Service story from a recent job.',
      complaint ? `The reported issue was: ${complaint}.` : '',
      diagnosis ? `Technician-entered finding: ${diagnosis}.` : '',
      repair ? `Recorded work performed: ${repair}.` : '',
      materials.length ? `Installed materials: ${materials.join(', ')}.` : '',
      result ? `Final result: ${result}.` : '',
      mediaLine ? `Selected media: ${mediaLine}.` : '',
    ].filter(Boolean).join('\n');
  }

  if (channel === 'LinkedIn') {
    return [
      system ? `Technical service update: ${system}.` : 'Technical service update.',
      complaint ? `Documented request: ${complaint}.` : '',
      diagnosis ? `Confirmed finding entered by the technician: ${diagnosis}.` : '',
      repair ? `Work performed: ${repair}.` : '',
      materials.length ? `Confirmed installed parts/materials: ${materials.join(', ')}.` : '',
      result ? `Verification/result: ${result}.` : '',
    ].filter(Boolean).join('\n');
  }

  if (channel === 'Google Business') {
    return [
      system ? `Service update for ${system}.` : 'Service update.',
      complaint ? `Reported issue: ${complaint}.` : '',
      repair ? `Work performed: ${repair}.` : '',
      result ? `Result: ${result}.` : '',
    ].filter(Boolean).join(' ');
  }

  if (channel === 'Blog / Case Study') {
    return [
      system ? `System\n${system}` : '',
      complaint ? `Problem\n${complaint}` : '',
      diagnosis ? `Findings\n${diagnosis}` : '',
      repair || materials.length ? `Work\n${[repair, materials.length ? `Installed materials: ${materials.join(', ')}` : ''].filter(Boolean).join('\n')}` : '',
      result ? `Result\n${result}` : '',
      mediaLine ? `Media\n${mediaLine}` : '',
    ].filter(Boolean).join('\n\n');
  }

  return [
    `Hook: ${system ? `A service update for ${system}.` : 'A service update from the field.'}`,
    complaint ? `Scene 1: Reported issue - ${complaint}.` : '',
    diagnosis ? `Scene 2: Technician finding - ${diagnosis}.` : mediaLine ? `Scene 2: Selected media - ${mediaLine}.` : '',
    repair || materials.length
      ? `Scene 3: ${[repair ? `Work performed - ${repair}` : '', materials.length ? `Installed materials - ${materials.join(', ')}` : ''].filter(Boolean).join('; ')}.`
      : '',
    result ? `CTA: Final result - ${result}. Contact the team for documented service support.` : 'CTA: Contact the team for documented service support.',
  ].filter(Boolean).join('\n');
}

function orderedClaims(context: AssistantJobContext) {
  const { publicSafe } = context;
  return [
    publicSafe.systemEquipment,
    publicSafe.complaint,
    publicSafe.diagnosis,
    publicSafe.repairPerformed,
    ...publicSafe.installedMaterials,
    publicSafe.finalResult,
    selectedMediaClaim(context),
  ].filter((claim): claim is AssistantClaim => Boolean(claim));
}

function selectedMediaClaim(context: AssistantJobContext): AssistantClaim | undefined {
  const selected = context.publicSafe.media.filter((item) => item.selected);
  if (!selected.length) return undefined;
  const labels = selected.map((item) => item.label).filter(Boolean);
  const labelText = labels.length ? ` Labels: ${Array.from(new Set(labels)).join(', ')}.` : '';
  return {
    id: 'selected-media',
    label: 'Selected media',
    text: `${selected.length} selected media item${selected.length === 1 ? '' : 's'}.${labelText}`,
    source: 'Attachment metadata',
  };
}

function cleanLocalFact(value: string | undefined, context: Pick<AssistantJobContext, 'privateValues'>) {
  const scrubbed = scrubAssistantText(value?.trim() ?? '', context);
  return scrubbed || undefined;
}

function makeClaim(
  id: string,
  label: string,
  value: string | undefined,
  source: AssistantEvidenceSource,
  context: Pick<AssistantJobContext, 'privateValues'>,
): AssistantClaim | undefined {
  const text = scrubAssistantText(value?.trim() ?? '', context);
  return text ? { id, label, text, source } : undefined;
}

function privateValuesForJob(job: AssistantJobInput) {
  return uniqueValues([
    job.jobNumber,
    job.clientName,
    job.organization,
    job.phone,
    job.email,
    job.address,
    job.serviceCallFee,
    job.scfPayment,
    job.labor,
    job.laborPayment,
    job.notes,
    ...(job.comments ?? []).map((comment) => comment.message),
    ...(job.invoices ?? []).flatMap((invoice) => [invoice.invoiceNumber, invoice.amount, invoice.status]),
  ]);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
