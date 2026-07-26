import { validateRequestBody } from './schemas.js';
import { buildAuthorizedContext } from './context.js';
import { generateWithProvider } from './orchestrator.js';
import { deterministicFallback } from './fallback.js';
import { maxRequestBytes } from './contracts.js';

export async function handleContentGeneration({ rawBody, authorization, auth, repository, provider, guards, config, telemetry }) {
  if (!authorization?.startsWith('Bearer ')) throw new HttpError('AUTH_REQUIRED', 401);
  if (byteLength(rawBody) > maxRequestBytes) throw new HttpError('INVALID_REQUEST', 400);
  const request = validateRequestBody(JSON.parse(rawBody || '{}'));
  const session = await auth.resolveSession(authorization);
  const context = await buildAuthorizedContext({ request, session, repository });
  const cacheKey = [context.companyId, context.actorId, request.jobId, request.channel, request.promptVersion, request.idempotencyKey].join(':');
  const cached = guards.get(cacheKey);
  if (cached) return cached;
  if (!guards.allow(`${context.companyId}:${context.actorId}`)) {
    const result = deterministicFallback(request, context, { code: 'RATE_LIMITED', message: 'Generation limit reached; fallback draft was generated without calling an AI provider.' });
    guards.set(cacheKey, result);
    return result;
  }
  const result = await generateWithProvider({ request, context, provider, config, telemetry });
  guards.set(cacheKey, result);
  return result;
}

export class HttpError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}
