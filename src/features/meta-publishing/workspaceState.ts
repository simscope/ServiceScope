import {
  normalizeFacebookPublishingMessage,
  type FacebookActiveScheduledPublication,
  type FacebookPublicationSummary,
  type FacebookPublishingSnapshot,
} from './contracts.js';

export type FacebookPublishWorkspaceState = {
  confirmationOpen: boolean;
  mode: 'text_only' | 'single_photo';
  delivery: 'now' | 'scheduled';
  approved: boolean;
  approvedMessage: string;
  approvedAttachmentId: string | null;
  approvedScheduledFor: string | null;
  approvedScheduledTimezone: string | null;
  idempotencyKey: string | null;
  submitting: boolean;
  result: FacebookPublicationSummary | null;
  error: string;
  errorCode: string;
  cancelConfirmationOpen: boolean;
  cancelling: boolean;
};

export const emptyFacebookPublishWorkspace: FacebookPublishWorkspaceState = {
  confirmationOpen: false,
  mode: 'text_only',
  delivery: 'now',
  approved: false,
  approvedMessage: '',
  approvedAttachmentId: null,
  approvedScheduledFor: null,
  approvedScheduledTimezone: null,
  idempotencyKey: null,
  submitting: false,
  result: null,
  error: '',
  errorCode: '',
  cancelConfirmationOpen: false,
  cancelling: false,
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

export function currentFacebookPublication(
  state: FacebookPublishWorkspaceState,
  snapshot: FacebookPublishingSnapshot | null,
) {
  return state.result ?? snapshot?.lastPublication ?? null;
}

export function currentFacebookActiveSchedule(
  state: FacebookPublishWorkspaceState,
  snapshot: FacebookPublishingSnapshot | null,
): FacebookActiveScheduledPublication | FacebookPublicationSummary | null {
  return state.result?.status === 'scheduled'
    ? state.result
    : snapshot?.activeScheduledPublication ?? null;
}

export function reconcileFacebookPublishWorkspaceFromStatus(
  state: FacebookPublishWorkspaceState,
  snapshot: FacebookPublishingSnapshot,
): FacebookPublishWorkspaceState {
  const activeSchedule = snapshot.activeScheduledPublication?.status === 'scheduled';
  return {
    ...state,
    result: null,
    cancelConfirmationOpen: activeSchedule ? state.cancelConfirmationOpen : false,
    cancelling: activeSchedule ? state.cancelling : false,
    approved: state.cancelConfirmationOpen && !activeSchedule ? false : state.approved,
  };
}

export function openFacebookPublishConfirmation(
  message: string,
  idempotencyKey: string,
  mode: 'text_only' | 'single_photo' = 'text_only',
  attachmentId: string | null = null,
  delivery: 'now' | 'scheduled' = 'now',
  scheduledFor: string | null = null,
  scheduledTimezone: string | null = null,
): FacebookPublishWorkspaceState {
  return {
    ...emptyFacebookPublishWorkspace,
    confirmationOpen: true,
    mode,
    delivery,
    approvedMessage: message,
    approvedAttachmentId: attachmentId,
    approvedScheduledFor: scheduledFor,
    approvedScheduledTimezone: scheduledTimezone,
    idempotencyKey,
  };
}

export function invalidateFacebookPublishApproval(
  state: FacebookPublishWorkspaceState,
  currentMessage: string,
  currentMode: 'text_only' | 'single_photo' = state.mode,
  currentAttachmentId: string | null = state.approvedAttachmentId,
  currentDelivery: 'now' | 'scheduled' = state.delivery,
  currentScheduledFor: string | null = state.approvedScheduledFor,
  currentScheduledTimezone: string | null = state.approvedScheduledTimezone,
) {
  let normalized = '';
  try {
    normalized = normalizeFacebookPublishingMessage(currentMessage);
  } catch {
    return resetFacebookPublishWorkspace();
  }
  if (
    !state.approvedMessage
    || (
      normalized === state.approvedMessage
      && currentMode === state.mode
      && currentAttachmentId === state.approvedAttachmentId
      && currentDelivery === state.delivery
      && currentScheduledFor === state.approvedScheduledFor
      && currentScheduledTimezone === state.approvedScheduledTimezone
    )
  ) return state;
  return resetFacebookPublishWorkspace();
}

export function openFacebookScheduleCancellation(state: FacebookPublishWorkspaceState) {
  if (state.submitting || state.cancelling) return state;
  return { ...state, confirmationOpen: false, cancelConfirmationOpen: true, approved: false, error: '', errorCode: '' };
}

export function beginFacebookScheduleCancellation(state: FacebookPublishWorkspaceState) {
  if (!state.cancelConfirmationOpen || !state.approved || state.cancelling || state.submitting) {
    return { state, shouldSubmit: false };
  }
  return {
    state: { ...state, cancelling: true, error: '', errorCode: '' },
    shouldSubmit: true,
  };
}

export function beginFacebookPublishSubmission(state: FacebookPublishWorkspaceState) {
  if (!state.confirmationOpen || !state.approved || !state.idempotencyKey || state.submitting) {
    return { state, shouldSubmit: false };
  }
  return { state: { ...state, submitting: true, error: '' }, shouldSubmit: true };
}
