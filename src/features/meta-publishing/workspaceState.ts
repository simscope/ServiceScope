import { normalizeFacebookPublishingMessage, type FacebookPublicationSummary } from './contracts.js';

export type FacebookPublishWorkspaceState = {
  confirmationOpen: boolean;
  mode: 'text_only' | 'single_photo';
  approved: boolean;
  approvedMessage: string;
  approvedAttachmentId: string | null;
  idempotencyKey: string | null;
  submitting: boolean;
  result: FacebookPublicationSummary | null;
  error: string;
  errorCode: string;
};

export const emptyFacebookPublishWorkspace: FacebookPublishWorkspaceState = {
  confirmationOpen: false,
  mode: 'text_only',
  approved: false,
  approvedMessage: '',
  approvedAttachmentId: null,
  idempotencyKey: null,
  submitting: false,
  result: null,
  error: '',
  errorCode: '',
};

export function resetFacebookPublishWorkspace(): FacebookPublishWorkspaceState {
  return { ...emptyFacebookPublishWorkspace };
}

export function facebookPublicationInProgress(lastPublication: FacebookPublicationSummary | null | undefined) {
  return lastPublication?.status === 'publishing';
}

export function facebookPublicationNeedsPageCheck(
  lastPublication: FacebookPublicationSummary | null | undefined,
  errorCode = '',
) {
  return lastPublication?.status === 'delivery_unknown' || errorCode === 'META_PUBLICATION_DELIVERY_UNKNOWN';
}

export function openFacebookPublishConfirmation(
  message: string,
  idempotencyKey: string,
  mode: 'text_only' | 'single_photo' = 'text_only',
  attachmentId: string | null = null,
): FacebookPublishWorkspaceState {
  return {
    ...emptyFacebookPublishWorkspace,
    confirmationOpen: true,
    mode,
    approvedMessage: message,
    approvedAttachmentId: attachmentId,
    idempotencyKey,
  };
}

export function invalidateFacebookPublishApproval(
  state: FacebookPublishWorkspaceState,
  currentMessage: string,
  currentMode: 'text_only' | 'single_photo' = state.mode,
  currentAttachmentId: string | null = state.approvedAttachmentId,
) {
  let normalized = '';
  try {
    normalized = normalizeFacebookPublishingMessage(currentMessage);
  } catch {
    return resetFacebookPublishWorkspace();
  }
  if (
    !state.approvedMessage
    || (normalized === state.approvedMessage && currentMode === state.mode && currentAttachmentId === state.approvedAttachmentId)
  ) return state;
  return resetFacebookPublishWorkspace();
}

export function beginFacebookPublishSubmission(state: FacebookPublishWorkspaceState) {
  if (!state.confirmationOpen || !state.approved || !state.idempotencyKey || state.submitting) {
    return { state, shouldSubmit: false };
  }
  return { state: { ...state, submitting: true, error: '' }, shouldSubmit: true };
}
