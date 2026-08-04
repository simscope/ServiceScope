import { supabaseFunction } from '../../services/supabaseRest';
import type {
  MetaConnectionSnapshot,
  MetaAuthorizationIntent,
  MetaOAuthCallbackPayload,
  MetaReturnDestination,
  MetaSafeConnection,
  MetaSafeAsset,
} from './contracts';

const functionName = 'meta-social-connection';

export function loadMetaConnectionStatus(companyId: string) {
  return supabaseFunction<MetaConnectionSnapshot>(functionName, { action: 'status', companyId });
}

export function startMetaConnection(companyId: string, authorizationIntent?: MetaAuthorizationIntent) {
  return supabaseFunction<{ ok: true; authorizationUrl: string }>(functionName, {
    action: 'start',
    companyId,
    returnPath: '/settings/social-connections',
    ...(authorizationIntent ? { authorizationIntent } : {}),
  });
}

export function completeMetaConnection(callback: MetaOAuthCallbackPayload) {
  return supabaseFunction<{
    ok: true;
    status: 'pending_asset_selection';
    oauthSessionId: string;
    assets: MetaSafeAsset[];
    destination: MetaReturnDestination;
  }>(functionName, {
    action: 'complete',
    code: callback.code,
    state: callback.state,
    providerError: callback.providerError,
    providerErrorReason: callback.providerErrorReason,
  }, { timeoutMs: 20_000 });
}

export function selectMetaAsset(companyId: string, oauthSessionId: string, pageId: string) {
  return supabaseFunction<{ ok: true; connection: MetaSafeConnection }>(functionName, {
    action: 'select_asset',
    companyId,
    oauthSessionId,
    pageId,
  });
}

export function checkMetaConnection(companyId: string, connectionId: string) {
  return supabaseFunction<{ ok: boolean; code?: string; connection: MetaSafeConnection }>(functionName, {
    action: 'check_health',
    companyId,
    connectionId,
  }, { timeoutMs: 20_000 });
}

export function disconnectMetaConnection(companyId: string, connectionId: string) {
  return supabaseFunction<{ ok: true; status: 'revoked' }>(functionName, {
    action: 'disconnect',
    companyId,
    connectionId,
  }, { timeoutMs: 20_000 });
}
