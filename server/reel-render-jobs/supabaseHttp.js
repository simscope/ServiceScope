import { RenderJobError } from './contracts.js';

export function createSupabaseHttpClient(env = process.env, fetchImpl = fetch) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  const anonKey = String(env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? env.SERVICE_ROLE_KEY ?? '');
  if (!url || !anonKey) throw new RenderJobError('REEL_RENDER_NOT_CONFIGURED', 503);

  async function request(path, { method = 'GET', token, service = false, body, headers = {}, binary = false } = {}) {
    if (service && !serviceKey) throw new RenderJobError('REEL_RENDER_NOT_CONFIGURED', 503);
    const accessToken = service ? serviceKey : token;
    if (!accessToken) throw new RenderJobError('AUTH_REQUIRED', 401);
    const response = await fetchImpl(`${url}${path}`, {
      method,
      headers: {
        apikey: service ? serviceKey : anonKey,
        Authorization: `Bearer ${accessToken}`,
        ...headers,
      },
      body,
    });
    if (!response.ok) throw new RenderJobError(response.status === 401 ? 'AUTH_REQUIRED' : 'REEL_RENDER_SERVICE_UNAVAILABLE', response.status);
    if (binary) return new Uint8Array(await response.arrayBuffer());
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    async authenticate(bearer) {
      if (!bearer?.startsWith('Bearer ')) throw new RenderJobError('AUTH_REQUIRED', 401);
      const token = bearer.slice(7);
      const user = await request('/auth/v1/user', { token });
      if (!user?.id) throw new RenderJobError('AUTH_REQUIRED', 401);
      return { token, userId: user.id };
    },
    userRpc(name, body, token) {
      return request(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
        method: 'POST', token, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
      });
    },
    adminRpc(name, body) {
      return request(`/rest/v1/rpc/${encodeURIComponent(name)}`, {
        method: 'POST', service: true, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
      });
    },
    select(table, query) {
      return request(`/rest/v1/${encodeURIComponent(table)}?${query}`, { service: true });
    },
    download(bucket, path) {
      return request(`/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath(path)}`, { service: true, binary: true });
    },
    upload(bucket, path, bytes, contentType) {
      return request(`/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath(path)}`, {
        method: 'POST', service: true, body: bytes, headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
      });
    },
    async sign(bucket, path, expiresIn) {
      const result = await request(`/storage/v1/object/sign/${encodeURIComponent(bucket)}/${objectPath(path)}`, {
        method: 'POST', service: true, body: JSON.stringify({ expiresIn }), headers: { 'Content-Type': 'application/json' },
      });
      const signed = result?.signedURL ?? result?.signedUrl;
      return { signedURL: typeof signed === 'string' && signed.startsWith('/') ? `${url}${signed}` : signed };
    },
  };
}

function objectPath(value) {
  return String(value).split('/').map(encodeURIComponent).join('/');
}
