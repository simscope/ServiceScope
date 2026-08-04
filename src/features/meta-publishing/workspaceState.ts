import { normalizeFacebookPublishingMessage, type FacebookPublicationSummary } from './contracts.js';

export type FacebookPublishWorkspaceState = {
  confirmationOpen: boolean;
  approved: boolean;
  approvedMessage: string;
  idempotencyKey: string | null;
  submitting: boolean;
  result: FacebookPublicationSummary | null;
  error: string;
  errorCode: string;
  pageCheckAcknowledged: boolean;
};

export const emptyFacebookPublishWorkspace: FacebookPublishWorkspaceState = {
  confirmationOpen: false,
  approved: false,
  approvedMessage: '',
  idempotencyKey: null,
  submitting: false,
  result: null,
  error: '',
  errorCode: '',
  pageCheckAcknowledged: false,
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

export function openFacebookPublishConfirmation(message: string, idempotencyKey: string): FacebookPublishWorkspaceState {
  return {
    ...emptyFacebookPublishWorkspace,
    confirmationOpen: true,
    approvedMessage: message,
    idempotencyKey,
  };
}

export function invalidateFacebookPublishApproval(state: FacebookPublishWorkspaceState, currentMessage: string) {
  let normalized = '';
  try {
    normalized = normalizeFacebookPublishingMessage(currentMessage);
  } catch {
    return resetFacebookPublishWorkspace();
  }
  if (!state.approvedMessage || normalized === state.approvedMessage) return state;
  return resetFacebookPublishWorkspace();
}

export function beginFacebookPublishSubmission(state: FacebookPublishWorkspaceState) {
  if (!state.confirmationOpen || !state.approved || !state.idempotencyKey || state.submitting) {
    return { state, shouldSubmit: false };
  }
  return { state: { ...state, submitting: true, error: '' }, shouldSubmit: true };
}
