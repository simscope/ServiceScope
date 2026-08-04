import {
  META_AUTHORIZATION_INTENTS,
  META_FACEBOOK_PUBLISHING_SCOPE,
  META_PROVIDER,
  MetaConnectionError,
  safeAsset,
  sanitizeMetaProviderDiagnostic,
} from './contracts.js';

const PAGE_FIELDS = 'id,name,tasks,access_token,instagram_business_account{id,username,account_type}';
const MAX_PAGE_REQUESTS = 5;
const MAX_DISCOVERED_PAGES = 100;

export function createMetaProvider({ config, fetchImpl = globalThis.fetch, cryptoApi = globalThis.crypto }) {
  const graphBase = `https://graph.facebook.com/${config.graphApiVersion}`;

  return {
    id: META_PROVIDER,

    buildAuthorizationUrl({ state, authorizationIntent }) {
      const url = new URL(`https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`);
      const searchParams = new URLSearchParams({
        client_id: config.appId,
        redirect_uri: config.redirectUri,
        config_id: config.loginConfigurationId,
        response_type: 'code',
        override_default_response_type: 'true',
        state,
      });
      if (authorizationIntent === META_AUTHORIZATION_INTENTS[0]) {
        searchParams.set('scope', META_FACEBOOK_PUBLISHING_SCOPE);
        searchParams.set('auth_type', 'rerequest');
      }
      url.search = searchParams.toString();
      return url.toString();
    },

    async exchangeCode({ code, signal }) {
      const shortLived = await formRequest(`${graphBase}/oauth/access_token`, {
        client_id: config.appId,
        client_secret: config.appSecret,
        redirect_uri: config.redirectUri,
        code,
      }, signal, 'short_token_exchange');
      const shortToken = tokenFromResponse(shortLived.payload, shortLived.httpStatus, 'short_token_exchange');

      const longLived = await formRequest(`${graphBase}/oauth/access_token`, {
        grant_type: 'fb_exchange_token',
        client_id: config.appId,
        client_secret: config.appSecret,
        fb_exchange_token: shortToken.accessToken,
      }, signal, 'long_token_exchange');
      return tokenFromResponse(longLived.payload, longLived.httpStatus, 'long_token_exchange');
    },

    async discover({ userAccessToken, signal }) {
      const permissions = await graphGet('/me/permissions', userAccessToken, signal, true, {}, 'META_TOKEN_INVALID');
      const grantedScopes = Array.isArray(permissions.payload.data)
        ? permissions.payload.data.filter((item) => item?.status === 'granted').map((item) => item.permission)
        : [];
      const pagesById = new Map();
      let cursor = null;
      let maxAttempts = permissions.attempts;
      let pageRequestAttempts = 0;

      while (pageRequestAttempts < MAX_PAGE_REQUESTS) {
        const query = { fields: PAGE_FIELDS, limit: '25' };
        if (cursor) query.after = cursor;
        const remainingAttempts = MAX_PAGE_REQUESTS - pageRequestAttempts;
        const pageResult = await graphGet(
          '/me/accounts',
          userAccessToken,
          signal,
          true,
          query,
          'OAUTH_PROVIDER_ERROR',
          Math.min(2, remainingAttempts),
        );
        pageRequestAttempts += pageResult.attempts;
        maxAttempts = Math.max(maxAttempts, pageResult.attempts);
        const values = Array.isArray(pageResult.payload.data) ? pageResult.payload.data : [];
        for (const value of values) {
          const page = normalizeDiscoveredPage(value);
          if (!pagesById.has(page.pageId)) pagesById.set(page.pageId, page);
          if (pagesById.size > MAX_DISCOVERED_PAGES) throw withAttempts(new MetaConnectionError('META_PAGE_DISCOVERY_LIMIT'), maxAttempts);
        }

        cursor = nextCursor(pageResult.payload.paging);
        if (!cursor) break;
        if (pageRequestAttempts >= MAX_PAGE_REQUESTS) {
          throw withAttempts(new MetaConnectionError('META_PAGE_DISCOVERY_LIMIT'), maxAttempts);
        }
      }

      return { grantedScopes, pages: [...pagesById.values()], attempts: maxAttempts };
    },

    async checkHealth({ userAccessToken, pageAccessToken, pageId, instagramAccountId, signal }) {
      const [permissions, page] = await Promise.all([
        graphGet('/me/permissions', userAccessToken, signal, true, {}, 'META_TOKEN_INVALID'),
        graphGet(`/${encodeURIComponent(pageId)}`, pageAccessToken, signal, true, {
          fields: 'id,name,instagram_business_account{id,username,account_type}',
        }, 'META_PAGE_UNAVAILABLE'),
      ]);
      const attempts = Math.max(permissions.attempts, page.attempts);
      const grantedScopes = Array.isArray(permissions.payload.data)
        ? permissions.payload.data.filter((item) => item?.status === 'granted').map((item) => item.permission)
        : [];
      if (String(page.payload.id ?? '') !== pageId) {
        throw withAttempts(new MetaConnectionError('META_PAGE_UNAVAILABLE'), attempts);
      }
      const currentInstagramId = page.payload.instagram_business_account?.id
        ? String(page.payload.instagram_business_account.id)
        : null;
      if (instagramAccountId && currentInstagramId !== instagramAccountId) {
        throw withAttempts(new MetaConnectionError('META_INSTAGRAM_ACCOUNT_MISMATCH'), attempts);
      }
      return { grantedScopes, pageAvailable: true, attempts };
    },
  };

  async function graphGet(
    path,
    accessToken,
    signal,
    allowRetry,
    query = {},
    fallbackCode = 'OAUTH_PROVIDER_ERROR',
    attemptLimit = allowRetry ? 2 : 1,
  ) {
    const proof = await appSecretProof(accessToken, config.appSecret, cryptoApi);
    const url = new URL(`${graphBase}${path}`);
    for (const [key, value] of Object.entries({ ...query, appsecret_proof: proof })) url.searchParams.set(key, value);
    let attempts = 0;
    const boundedAttemptLimit = Math.max(1, Math.min(allowRetry ? 2 : 1, attemptLimit));
    for (let attempt = 0; attempt < boundedAttemptLimit; attempt += 1) {
      attempts += 1;
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
          signal,
        });
      } catch {
        if (signal?.aborted) throw withAttempts(new MetaConnectionError('META_PROVIDER_TIMEOUT'), attempts);
        if (attempt + 1 < boundedAttemptLimit) continue;
        throw withAttempts(new MetaConnectionError('META_PROVIDER_UNAVAILABLE'), attempts);
      }
      const payload = await readJson(response);
      if (response.ok) return { payload, attempts };
      if (response.status >= 500 && attempt + 1 < boundedAttemptLimit) continue;
      throw withAttempts(providerFailure(payload, response.status, fallbackCode), attempts);
    }
    throw withAttempts(new MetaConnectionError('META_PROVIDER_UNAVAILABLE'), attempts);
  }

  async function formRequest(url, values, signal, phase) {
    const providerAttempts = exchangeAttemptForPhase(phase);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(values),
        signal,
      });
    } catch {
      throw new MetaConnectionError(
        signal?.aborted ? 'META_PROVIDER_TIMEOUT' : 'META_PROVIDER_UNAVAILABLE',
        undefined,
        {
          providerPhase: phase,
          providerHttpStatus: null,
          providerCode: null,
          providerSubcode: null,
          providerCategory: 'PROVIDER_TEMPORARY_ERROR',
          providerIsTransient: true,
          providerAttempts,
        },
      );
    }
    const payload = await readJson(response);
    if (!response.ok) {
      throw new MetaConnectionError(
        'OAUTH_CODE_EXCHANGE_FAILED',
        undefined,
        normalizeMetaProviderDiagnostic(payload, response.status, phase),
      );
    }
    return { payload, httpStatus: response.status };
  }
}

export async function appSecretProof(accessToken, appSecret, cryptoApi = globalThis.crypto) {
  const key = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await cryptoApi.subtle.sign('HMAC', key, new TextEncoder().encode(accessToken));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function nextCursor(paging) {
  if (!paging || typeof paging !== 'object') return null;
  const value = paging.cursors?.after;
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._~=-]{1,512}$/.test(value)) {
    throw new MetaConnectionError('OAUTH_PROVIDER_ERROR');
  }
  return value;
}

function normalizeDiscoveredPage(value) {
  const normalized = safeAsset({
    pageId: String(value?.id ?? ''),
    pageName: value?.name,
    tasks: value?.tasks,
    instagram: value?.instagram_business_account ? {
      accountId: String(value.instagram_business_account.id ?? ''),
      username: value.instagram_business_account.username,
      accountType: value.instagram_business_account.account_type,
    } : null,
  });
  const accessToken = typeof value?.access_token === 'string' && value.access_token.length <= 4096
    ? value.access_token
    : '';
  if (!accessToken) throw new MetaConnectionError('OAUTH_PROVIDER_ERROR');
  return { ...normalized, accessToken };
}

function tokenFromResponse(value, httpStatus, phase) {
  const accessToken = typeof value?.access_token === 'string' && value.access_token.trim() && value.access_token.length <= 4096
    ? value.access_token
    : '';
  if (!accessToken) {
    throw new MetaConnectionError('OAUTH_CODE_EXCHANGE_FAILED', undefined, {
      providerPhase: phase,
      providerHttpStatus: httpStatus,
      providerCode: null,
      providerSubcode: null,
      providerCategory: 'SUCCESS_RESPONSE_MISSING_TOKEN',
      providerIsTransient: false,
      providerAttempts: exchangeAttemptForPhase(phase),
    });
  }
  const expiresIn = Number(value?.expires_in);
  return {
    accessToken,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
  };
}

export function normalizeMetaProviderDiagnostic(payload, httpStatus, phase) {
  const providerCode = safeProviderInteger(payload?.error?.code);
  const providerSubcode = safeProviderInteger(payload?.error?.error_subcode);
  const providerIsTransient = typeof payload?.error?.is_transient === 'boolean'
    ? payload.error.is_transient
    : null;
  const message = typeof payload?.error?.message === 'string' ? payload.error.message : '';
  return sanitizeMetaProviderDiagnostic({
    providerPhase: phase,
    providerHttpStatus: httpStatus,
    providerCode,
    providerSubcode,
    providerCategory: classifyMetaProviderError({ httpStatus, providerCode, providerIsTransient, message }),
    providerIsTransient,
    providerAttempts: exchangeAttemptForPhase(phase),
  });
}

function classifyMetaProviderError({ httpStatus, providerCode, providerIsTransient, message }) {
  if (httpStatus === 429 || [4, 17, 32, 613].includes(providerCode)) return 'PROVIDER_RATE_LIMIT';
  if (httpStatus >= 500 || providerIsTransient === true) return 'PROVIDER_TEMPORARY_ERROR';
  if (/\b(?:authorization\s+)?code\b[^.]{0,80}\b(?:already\s+(?:been\s+)?used|was\s+used)\b/i.test(message)) {
    return 'CODE_ALREADY_USED';
  }
  if (/\b(?:redirect_uri|redirect\s+uri)\b[^.]{0,100}\b(?:mismatch|does\s+not\s+match|must\s+match|not\s+identical|invalid)\b/i.test(message)) {
    return 'REDIRECT_URI_MISMATCH';
  }
  if (/\b(?:invalid|incorrect|missing)\b[^.]{0,60}\b(?:client\s+(?:secret|credentials?)|app\s+secret)\b|\bclient_secret\b[^.]{0,60}\b(?:invalid|incorrect|missing)\b/i.test(message)) {
    return 'INVALID_CLIENT_CREDENTIALS';
  }
  if (/\b(?:authorization\s+)?code\b[^.]{0,80}\b(?:invalid|expired|has\s+expired)\b|\b(?:invalid|expired)\b[^.]{0,80}\b(?:authorization\s+)?code\b/i.test(message)) {
    return 'INVALID_OR_EXPIRED_CODE';
  }
  if (/\b(?:unsupported|unknown|missing)\b[^.]{0,80}\b(?:grant(?:_type)?|parameter|request)\b|\bgrant_type\b[^.]{0,60}\bunsupported\b/i.test(message)) {
    return 'UNSUPPORTED_GRANT_OR_PARAMETER';
  }
  if (/\b(?:app|application)\b[^.]{0,100}\b(?:configuration|not\s+configured|disabled|inactive|not\s+set\s+up)\b/i.test(message)) {
    return 'APP_CONFIGURATION_ERROR';
  }
  return 'UNKNOWN_PROVIDER_REJECTION';
}

function exchangeAttemptForPhase(phase) {
  if (phase === 'short_token_exchange') return 1;
  if (phase === 'long_token_exchange') return 2;
  return null;
}

function safeProviderInteger(value) {
  return Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647 ? value : null;
}

function providerFailure(payload, status, fallbackCode) {
  const providerCode = Number(payload?.error?.code);
  if (status === 429 || [4, 17, 32, 613].includes(providerCode)) return new MetaConnectionError('META_RATE_LIMITED');
  if (providerCode === 190 || status === 401) return new MetaConnectionError('META_TOKEN_INVALID');
  if (status >= 500) return new MetaConnectionError('META_PROVIDER_UNAVAILABLE');
  return new MetaConnectionError(fallbackCode);
}

function withAttempts(error, attempts) {
  error.providerAttempts = attempts;
  return error;
}

async function readJson(response) {
  try {
    const value = await response.json();
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}
