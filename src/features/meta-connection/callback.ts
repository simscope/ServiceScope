import type { MetaOAuthCallbackPayload } from './contracts';

export const META_CALLBACK_PATH = '/auth/meta/callback';
let consumedCallback: MetaOAuthCallbackPayload | null | undefined;

export function consumeMetaOAuthCallbackLocation(location = window.location, history = window.history) {
  if (consumedCallback !== undefined) return consumedCallback;
  if (location.pathname !== META_CALLBACK_PATH) {
    consumedCallback = null;
    return null;
  }
  const params = new URLSearchParams(location.search);
  consumedCallback = {
    code: clean(params.get('code'), 4096),
    state: clean(params.get('state'), 512),
    providerError: clean(params.get('error'), 80),
    providerErrorReason: clean(params.get('error_reason') ?? params.get('error_description'), 80),
  };
  history.replaceState(null, '', META_CALLBACK_PATH);
  return consumedCallback;
}

export function resetMetaOAuthCallbackForTests() {
  consumedCallback = undefined;
}

function clean(value: string | null, maxLength: number) {
  const normalized = value?.trim() ?? '';
  return normalized.length <= maxLength ? normalized : '';
}
