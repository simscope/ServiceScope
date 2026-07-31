import {
  META_PROVIDER,
  META_REQUESTED_SCOPES,
  MetaConnectionError,
  safeAsset,
} from './contracts.js';

export function createMetaProvider({ config, fetchImpl = globalThis.fetch, cryptoApi = globalThis.crypto }) {
  const graphBase = `https://graph.facebook.com/${config.graphApiVersion}`;

  return {
    id: META_PROVIDER,

    buildAuthorizationUrl({ state }) {
      const url = new URL(`https://www.facebook.com/${config.graphApiVersion}/dialog/oauth`);
      url.search = new URLSearchParams({
        client_id: config.appId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: META_REQUESTED_SCOPES.join(','),
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
      const [permissionsResult, pagesResult] = await Promise.all([
        graphGet('/me/permissions', userAccessToken, signal, true),
        graphGet(
          '/me/accounts',
          userAccessToken,
          signal,
          true,
          { fields: 'id,name,tasks,access_token,instagram_business_account{id,username,account_type}' },
        ),
      ]);
      const grantedScopes = Array.isArray(permissionsResult.data)
        ? permissionsResult.data.filter((item) => item?.status === 'granted').map((item) => item.permission)
        : [];
      const pages = Array.isArray(pagesResult.data) ? pagesResult.data.map(normalizeDiscoveredPage) : [];
      return { grantedScopes, pages };
    },

    async checkHealth({ userAccessToken, pageAccessToken, pageId, instagramAccountId, signal }) {
      const [permissionsResult, pageResult] = await Promise.all([
        graphGet('/me/permissions', userAccessToken, signal, true),
        graphGet(`/${encodeURIComponent(pageId)}`, pageAccessToken, signal, true, {
          fields: 'id,name,instagram_business_account{id,username,account_type}',
        }),
      ]);
      const grantedScopes = Array.isArray(permissionsResult.data)
        ? permissionsResult.data.filter((item) => item?.status === 'granted').map((item) => item.permission)
        : [];
      const currentInstagramId = pageResult.instagram_business_account?.id ?? null;
      if (instagramAccountId && currentInstagramId !== instagramAccountId) {
        throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
      }
      return { grantedScopes, pageAvailable: pageResult.id === pageId };
    },

    async revoke({ userAccessToken, signal }) {
      const proof = await appSecretProof(userAccessToken, config.appSecret, cryptoApi);
      const response = await fetchWithTimeout(`${graphBase}/me/permissions?appsecret_proof=${encodeURIComponent(proof)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userAccessToken}`, Accept: 'application/json' },
        signal,
      });
      if (!response.ok) throw providerFailure(await readJson(response), response.status, 'META_TOKEN_INVALID');
      const payload = await readJson(response);
      return payload.success === true;
    },
  };

  async function graphGet(path, accessToken, signal, allowRetry, query = {}) {
    const proof = await appSecretProof(accessToken, config.appSecret, cryptoApi);
    const url = new URL(`${graphBase}${path}`);
    for (const [key, value] of Object.entries({ ...query, appsecret_proof: proof })) url.searchParams.set(key, value);
    const request = () => fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal,
    });
    let response;
    for (let attempt = 0; attempt < (allowRetry ? 2 : 1); attempt += 1) {
      try {
        response = await request();
        if (response.ok || response.status < 500 || attempt === 1) break;
      } catch {
        if (signal?.aborted || attempt === 1 || !allowRetry) throw new MetaConnectionError('OAUTH_PROVIDER_ERROR');
      }
    }
    if (!response) throw new MetaConnectionError('OAUTH_PROVIDER_ERROR');
    const payload = await readJson(response);
    if (!response.ok) throw providerFailure(payload, response.status, 'META_TOKEN_INVALID');
    return payload;
  }

  async function formRequest(url, values, signal, fallbackCode) {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(values),
      signal,
    });
    const payload = await readJson(response);
    if (!response.ok) throw providerFailure(payload, response.status, fallbackCode);
    return payload;
  }

  async function fetchWithTimeout(url, init) {
    return fetchImpl(url, init);
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
  return new MetaConnectionError(fallbackCode);
}

async function readJson(response) {
  try {
    const value = await response.json();
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}
