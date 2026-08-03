export type FacebookPublicationStatus = 'publishing' | 'published' | 'failed' | 'delivery_unknown';

export type FacebookPublicationSummary = {
  status: FacebookPublicationStatus;
  approvedAt: string | null;
  publishedAt: string | null;
  errorCode: string | null;
};

export type FacebookPublishingSnapshot = {
  ok: true;
  configured: boolean;
  connected: boolean;
  facebookPageName: string | null;
  facebookPublishingEnabled: boolean;
  missingPermissions: string[];
  lastPublication: FacebookPublicationSummary | null;
};

export type FacebookPublishResult = FacebookPublicationSummary & {
  ok: boolean;
};

export const FACEBOOK_PUBLISH_ERROR_MESSAGES: Record<string, string> = {
  META_PUBLISHING_PERMISSION_MISSING: 'Publishing permission is not enabled. Reconnect Meta to add Facebook Page publishing access.',
  META_CONNECTION_NEEDS_REAUTHORIZATION: 'The Facebook Page connection needs to be reauthorized.',
  META_PUBLICATION_PRIVACY_REVIEW_REQUIRED: 'The final text contains information that requires privacy review.',
  META_PUBLICATION_IN_PROGRESS: 'This publication is already in progress.',
  META_PUBLICATION_FAILED: 'Facebook did not accept this publication.',
  META_PUBLICATION_PROVIDER_REJECTED: 'Facebook rejected this publication.',
  META_PUBLICATION_DELIVERY_UNKNOWN: 'Facebook did not confirm whether the post was published. Check the Page before attempting any new publication.',
};

export function normalizePublishingError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'INTERNAL_ERROR';
  return FACEBOOK_PUBLISH_ERROR_MESSAGES[code] ?? 'The Facebook publication could not be completed.';
}
