import type { FacebookPublicationSummary } from './contracts.js';

export type FacebookPublishWorkspaceState = {
  confirmationOpen: boolean;
  approved: boolean;
  approvedMessage: string;
  idempotencyKey: string | null;
  submitting: boolean;
  result: FacebookPublicationSummary | null;
  error: string;
};

export const emptyFacebookPublishWorkspace: FacebookPublishWorkspaceState = {
  confirmationOpen: false,
  approved: false,
  approvedMessage: '',
  idempotencyKey: null,
  submitting: false,
  result: null,
  error: '',
};

export function openFacebookPublishConfirmation(message: string, idempotencyKey: string): FacebookPublishWorkspaceState {
  return {
    ...emptyFacebookPublishWorkspace,
    confirmationOpen: true,
    approvedMessage: message,
    idempotencyKey,
  };
}

export function invalidateFacebookPublishApproval(state: FacebookPublishWorkspaceState, currentMessage: string) {
  if (!state.approvedMessage || currentMessage.trim() === state.approvedMessage) return state;
  return { ...emptyFacebookPublishWorkspace };
}

export function beginFacebookPublishSubmission(state: FacebookPublishWorkspaceState) {
  if (!state.confirmationOpen || !state.approved || !state.idempotencyKey || state.submitting) {
    return { state, shouldSubmit: false };
  }
  return { state: { ...state, submitting: true, error: '' }, shouldSubmit: true };
}
