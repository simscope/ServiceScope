export const META_PROVIDER = 'meta-facebook-login' as const;
export const META_REQUESTED_SCOPES = ['pages_show_list', 'pages_read_engagement', 'instagram_basic'] as const;

export type MetaConnectionStatus = 'connected' | 'needs_reauthorization' | 'error' | 'revoked';

export type MetaSafeAsset = {
  provider: typeof META_PROVIDER;
  pageId: string;
  pageName: string;
  permittedTasks: string[];
  instagram: null | {
    accountId: string;
    username: string;
    accountType: 'BUSINESS' | 'CREATOR';
  };
  connectionEligibility: 'facebook_only' | 'facebook_and_instagram';
};

export type MetaSafeConnection = {
  id: string;
  provider: typeof META_PROVIDER;
  status: MetaConnectionStatus;
  facebookPageId: string;
  facebookPageName: string;
  instagramAccountId: string | null;
  instagramUsername: string | null;
  instagramAccountType: 'BUSINESS' | 'CREATOR' | null;
  grantedScopes: string[];
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  tokenExpiryStatus: 'valid' | 'expired' | 'unknown';
};

export type MetaPendingSelection = {
  oauthSessionId: string;
  status: 'pending_asset_selection';
  expiresAt: string;
  assets: MetaSafeAsset[];
};

export type MetaConnectionSnapshot = {
  ok: true;
  provider: typeof META_PROVIDER;
  configured: boolean;
  graphApiVersion: string | null;
  requestedScopes: string[];
  connection: MetaSafeConnection | null;
  pending: MetaPendingSelection | null;
};

export type MetaOAuthCallbackPayload = {
  code: string;
  state: string;
  providerError: string;
  providerErrorReason: string;
};

export type MetaReturnDestination = 'social_connections';
