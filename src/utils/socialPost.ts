export type SocialPostJobInput = {
  system?: string;
  issue?: string;
  notes?: string;
  attachments?: Array<{ kind?: string }>;
  clientName?: string;
  organization?: string;
  phone?: string;
  email?: string;
  address?: string;
  jobNumber?: string;
};

export type SocialPostDraft = {
  headline: string;
  caption: string;
  hashtags: string[];
};

const CTA = 'Need commercial HVAC or equipment service? Contact our team.';
const PRIVATE_NOTE_PATTERNS = [
  /\b(access|door|gate|lock|key|alarm|entry)\s*(code|pin|password)\b/i,
  /\bprivate\b/i,
  /\binternal\b/i,
  /\bdo not publish\b/i,
  /\bdo not share\b/i,
];

function cleanText(value?: string) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function sentenceCase(value: string) {
  const clean = cleanText(value);
  if (!clean) return '';
  return clean.slice(0, 1).toUpperCase() + clean.slice(1);
}

function trimTrailingPunctuation(value: string) {
  return cleanText(value).replace(/[.!,;:\s]+$/g, '');
}

function isPublicNote(value: string) {
  const clean = cleanText(value);
  return clean.length > 0 && !PRIVATE_NOTE_PATTERNS.some((pattern) => pattern.test(clean));
}

function serviceLabel(system?: string) {
  const clean = trimTrailingPunctuation(system);
  return clean || 'Service';
}

function hashtagToken(value: string) {
  return cleanText(value).replace(/[^a-zA-Z0-9]+/g, '');
}

function uniqueTags(tags: string[]) {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateSocialPostDraft(job: SocialPostJobInput): SocialPostDraft {
  const system = serviceLabel(job.system);
  const issue = trimTrailingPunctuation(job.issue);
  const notes = isPublicNote(job.notes ?? '') ? trimTrailingPunctuation(job.notes) : '';
  const photoCount = (job.attachments ?? []).filter((attachment) => attachment.kind === 'photo').length;
  const headline = issue ? `${system} service: ${sentenceCase(issue)}` : `${system} service visit`;
  const captionLines = [
    issue ? `Our team completed a ${system.toLowerCase()} service visit for: ${sentenceCase(issue)}.` : `Our team completed a ${system.toLowerCase()} service visit.`,
    notes ? `Job notes: ${sentenceCase(notes)}.` : '',
    photoCount ? `${photoCount} job photo${photoCount === 1 ? '' : 's'} attached for review.` : '',
    CTA,
  ].filter(Boolean);
  const systemTag = hashtagToken(system);

  return {
    headline,
    caption: captionLines.join('\n\n'),
    hashtags: uniqueTags([
      '#HVACService',
      '#CommercialHVAC',
      '#EquipmentService',
      systemTag && systemTag.toLowerCase() !== 'service' ? `#${systemTag}Service` : '',
      '#PreventiveMaintenance',
      '#ServiceScope',
    ].filter(Boolean)).slice(0, 8),
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scrubOneValue(text: string, value?: string) {
  const clean = cleanText(value);
  if (!clean || clean.length < 2) return text;
  return text.replace(new RegExp(escapeRegExp(clean), 'gi'), '[removed]');
}

export function scrubPrivateJobValues(text: string, job: SocialPostJobInput) {
  return [
    job.clientName,
    job.organization,
    job.phone,
    job.email,
    job.address,
    job.jobNumber,
  ].reduce((current, value) => scrubOneValue(current, value), text);
}

export function formatSocialPostForCopy(draft: SocialPostDraft, job: SocialPostJobInput) {
  const hashtags = draft.hashtags.map((tag) => tag.trim()).filter(Boolean).join(' ');
  return scrubPrivateJobValues([draft.headline, draft.caption, hashtags].filter(Boolean).join('\n\n'), job);
}
