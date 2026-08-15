import { RenderJobError } from './contracts.js';

export function createSupabaseHttpClient(env = process.env, fetchImpl = fetch) {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  const anonKey = String(env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? env.SERVICE_ROLE_KEY ?? '');
  if (!url || !anonKey) throw new RenderJobError('REEL_RENDER_NOT_CONFIGURED', 503);

  async function responseFor(path, { method = 'GET', token, service = false, body, headers = {} } = {}) {
    if (service && !serviceKey) throw new RenderJobError('REEL_RENDER_NOT_CONFIGURED', 503);
    const accessToken = service ? serviceKey : token;
    if (!accessToken) throw new RenderJobError('AUTH_REQUIRED', 401);
    let response;
    try {
      response = await fetchImpl(`${url}${path}`, {
        method,
        headers: {
          apikey: service ? serviceKey : anonKey,
          Authorization: `Bearer ${accessToken}`,
          ...headers,
        },
        body,
      });
    } catch {
      throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
    }
    if (!response.ok) {
      const safeCode = await safeSupabaseErrorCode(response);
      if (safeCode) throw new RenderJobError(safeCode, safeCode === 'AUTH_REQUIRED' ? 401 : 409);
      throw new RenderJobError(response.status === 401 ? 'AUTH_REQUIRED' : 'REEL_RENDER_SERVICE_UNAVAILABLE', response.status);
    }
    return response;
  }

  async function request(path, options) {
    const response = await responseFor(path, options);
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
    }
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
    async downloadBounded(bucket, path, maxBytes) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RenderJobError('REEL_RENDER_CONTEXT_STALE', 409);
      const response = await responseFor(`/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath(path)}`, { service: true });
      const contentLength = parseContentLength(response.headers.get('content-length'));
      if (contentLength !== null && contentLength > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new RenderJobError('REEL_RENDER_CONTEXT_STALE', 409);
      }
      if (!response.body) return new Uint8Array();

      const reader = response.body.getReader();
      const bytes = new Uint8Array(maxBytes + 1);
      let length = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          const chunk = result.value;
          if (!(chunk instanceof Uint8Array)) throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
          if (length + chunk.byteLength > maxBytes) {
            throw new RenderJobError('REEL_RENDER_CONTEXT_STALE', 409);
          }
          bytes.set(chunk, length);
          length += chunk.byteLength;
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        if (error instanceof RenderJobError) throw error;
        throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
      } finally {
        reader.releaseLock();
      }
      return bytes.subarray(0, length);
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

const exposedDatabaseErrors = new Set([
  'AUTH_REQUIRED',
  'REEL_RENDER_PLAN_UNAVAILABLE',
  'REEL_RENDER_APPROVAL_REQUIRED',
  'REEL_RENDER_APPROVAL_CONFLICT',
]);

async function safeSupabaseErrorCode(response) {
  try {
    const payload = await response.clone().json();
    return exposedDatabaseErrors.has(payload?.message) ? payload.message : null;
  } catch {
    return null;
  }
}

function objectPath(value) {
  return String(value).split('/').map(encodeURIComponent).join('/');
}

function parseContentLength(value) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
