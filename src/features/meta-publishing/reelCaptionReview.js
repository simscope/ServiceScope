// Pure review state: no provider, persistence or render side effects.
export function newCaptionReview(scope, initialCaption = '') {
  return { scope, captionDraft: initialCaption, reviewedCaption: '', open: false, confirmed: false, edited: false, viewed: false };
}
export function captionReview(state, action) {
  switch (action.type) {
    case 'sync':
      if (state.scope !== action.scope) return newCaptionReview(action.scope, action.initialCaption);
      if (!state.edited && !state.viewed && state.captionDraft !== action.initialCaption)
        return { ...state, captionDraft: action.initialCaption, confirmed: false };
      return state;
    case 'open': return { ...state, open: true, viewed: true, reviewedCaption: state.captionDraft, confirmed: false };
    case 'close': return { ...state, open: false, confirmed: false };
    case 'edit': return { ...state, captionDraft: action.value, reviewedCaption: action.value, edited: true, confirmed: false };
    case 'normalize': return { ...state, captionDraft: action.value, reviewedCaption: action.value, confirmed: false };
    case 'confirm': return { ...state, confirmed: action.value === true && state.open };
    default: throw new Error('INVALID_CAPTION_REVIEW_ACTION');
  }
}
