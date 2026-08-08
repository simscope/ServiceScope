export const SCHEDULED_WORKER_SECRET_NAME = 'meta-scheduled-publisher';

export class ScheduledWorkerRequestError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'ScheduledWorkerRequestError';
    this.code = code;
    this.status = status;
  }
}

export async function authorizeScheduledWorkerRequest({
  method,
  rawBody,
  apiKey,
  authorization,
  secretKeysJson,
  cryptoApi = globalThis.crypto,
}) {
  if (method !== 'POST') throw new ScheduledWorkerRequestError('INVALID_REQUEST', 405);
  parseEmptyWorkerBody(rawBody);
  if (typeof authorization === 'string' && authorization.trim()) {
    throw new ScheduledWorkerRequestError('AUTH_REQUIRED', 401);
  }

  const expected = readNamedSecretKey(secretKeysJson, SCHEDULED_WORKER_SECRET_NAME);
  if (!expected) throw new ScheduledWorkerRequestError('WORKER_NOT_CONFIGURED', 500);
  const provided = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!provided.startsWith('sb_secret_') || !(await timingSafeEqual(provided, expected, cryptoApi))) {
    throw new ScheduledWorkerRequestError('AUTH_REQUIRED', 401);
  }
  return { workerSecretKey: expected };
}

export async function handleScheduledWorkerRequest(input) {
  const authorized = await authorizeScheduledWorkerRequest(input);
  const deps = input.createDependencies(authorized.workerSecretKey);
  return input.run(deps);
}

export function readNamedSecretKey(value, name) {
  try {
    const keys = typeof value === 'string' ? JSON.parse(value) : value;
    const key = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys[name] : null;
    return typeof key === 'string' && key.startsWith('sb_secret_') && key.length <= 512 ? key : null;
  } catch {
    return null;
  }
}

function parseEmptyWorkerBody(rawBody) {
  if (typeof rawBody !== 'string' || new TextEncoder().encode(rawBody).byteLength > 1024) {
    throw new ScheduledWorkerRequestError('INVALID_REQUEST', 400);
  }
  if (!rawBody.trim()) return;
  let value;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new ScheduledWorkerRequestError('INVALID_REQUEST', 400);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw new ScheduledWorkerRequestError('INVALID_REQUEST', 400);
  }
}

async function timingSafeEqual(left, right, cryptoApi) {
  if (!cryptoApi?.subtle) return false;
  const [leftDigest, rightDigest] = await Promise.all([
    cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(left)),
    cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = left.length ^ right.length;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}
