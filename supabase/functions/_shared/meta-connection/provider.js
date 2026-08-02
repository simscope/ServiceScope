import {
  META_PROVIDER,
  MetaConnectionError,
  safeAsset,
} from './contracts.js';

const PAGE_FIELDS = 'id,name,tasks,access_token,instagram_business_account{id,username,account_type}';
const MAX_PAGE_REQUESTS = 5;
const MAX_DISCOVERED_PAGES = 100;

export function createMetaProvider({ config, fetchImpl = globalThis.fetch, cryptoApi = globalThis.crypto }) {
  const graphBase = `https://graph.facebook.com/${config.graphApiVersion}`;

  return {
    id: META_PROVIDER,

    buildAuthorizationUrl({ state }) {
      const url = new URL(`https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`);
      url.search = new URLSearchParams({
        client_id: config.appId,
        redirect_uri: config.redirectUri,
        config_id: config.loginConfigurationId,
        response_type: 'code',
        override_default_response_type: 'true',
        state,
      }).toString();
      return url.toString();
    },

    async exchangeCode({ code, signal }) {
      const shortLived = await formRequest(`${graphBase}/oauth/access_token`, {
        client_id: config.appId,
        client_secret: config.appSecret,
        redirect_uri: config.redirectUri,
        code,
      }, signal, 'OAUTH_CODE_EXCHANGE_FAILED');
      const shortToken = tokenFromResponse(shortLived);

      const longLived = await formRequest(`${graphBase}/oauth/access_token`, {
        grant_type: 'fb_exchange_token',
        client_id: config.appId,
        client_secret: config.appSecret,
        fb_exchange_token: shortToken.accessToken,
      }, signal, 'OAUTH_CODE_EXCHANGE_FAILED');
      return tokenFromResponse(longLived);
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

  async function formRequest(url, values, signal, fallbackCode) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(values),
        signal,
      });
    } catch {
      throw new MetaConnectionError(signal?.aborted ? 'META_PROVIDER_TIMEOUT' : 'META_PROVIDER_UNAVAILABLE');
    }
    const payload = await readJson(response);
    if (!response.ok) throw providerFailure(payload, response.status, fallbackCode);
    return payload;
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

function tokenFromResponse(value) {
  const accessToken = typeof value?.access_token === 'string' && value.access_token.length <= 4096
    ? value.access_token
    : '';
  if (!accessToken) throw new MetaConnectionError('OAUTH_CODE_EXCHANGE_FAILED');
  const expiresIn = Number(value?.expires_in);
  return {
    accessToken,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
  };
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
