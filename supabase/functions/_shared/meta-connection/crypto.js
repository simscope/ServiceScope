import { META_PROVIDER, MetaConnectionError, decodeEncryptionKey } from './contracts.js';

export const ENVELOPE_SCHEMA = 'encrypted-social-token-v1';
const ALGORITHM = 'AES-GCM';
const PURPOSES = new Set(['meta-pending', 'meta-connection']);
const ENVELOPE_KEYS = ['algorithm', 'ciphertext', 'iv', 'keyVersion', 'purpose', 'schemaVersion'];

export function generateOAuthState(byteLength = 32, cryptoApi = globalThis.crypto) {
  if (!cryptoApi || byteLength < 32) throw new MetaConnectionError('INTERNAL_ERROR');
  const bytes = new Uint8Array(byteLength);
  cryptoApi.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function hashOAuthState(rawState, cryptoApi = globalThis.crypto) {
  if (typeof rawState !== 'string' || rawState.length < 43 || rawState.length > 512) {
    throw new MetaConnectionError('OAUTH_STATE_INVALID');
  }
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(rawState));
  return `\\x${toHex(new Uint8Array(digest))}`;
}

export function pendingEnvelopeContext({ companyId, actorId, oauthStateId, redirectUri }) {
  return canonicalContext({
    purpose: 'meta-pending',
    provider: META_PROVIDER,
    companyId,
    actorId,
    oauthStateId,
    redirectUri,
  });
}

export function connectionEnvelopeContext({ companyId, connectionId, pageId }) {
  return canonicalContext({
    purpose: 'meta-connection',
    provider: META_PROVIDER,
    companyId,
    connectionId,
    pageId,
  });
}

export async function encryptTokenBundle(value, encodedKey, context, cryptoApi = globalThis.crypto) {
  const aad = encodeContext(context);
  const key = await importKey(encodedKey, ['encrypt'], cryptoApi);
  const iv = new Uint8Array(12);
  cryptoApi.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await cryptoApi.subtle.encrypt({ name: ALGORITHM, iv, additionalData: aad }, key, plaintext);
  return {
    schemaVersion: ENVELOPE_SCHEMA,
    algorithm: ALGORITHM,
    keyVersion: 1,
    purpose: context.purpose,
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  };
}

export async function decryptTokenBundle(envelope, encodedKey, context, cryptoApi = globalThis.crypto) {
  try {
    assertEnvelope(envelope, context?.purpose);
    const aad = encodeContext(context);
    const key = await importKey(encodedKey, ['decrypt'], cryptoApi);
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: ALGORITHM, iv: base64UrlDecode(envelope.iv), additionalData: aad },
      key,
      base64UrlDecode(envelope.ciphertext),
    );
    const value = JSON.parse(new TextDecoder().decode(plaintext));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid bundle');
    return value;
  } catch {
    throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
  }
}

export function assertEnvelope(envelope, expectedPurpose) {
  const keys = envelope && typeof envelope === 'object' ? Object.keys(envelope).sort() : [];
  if (
    !envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
    keys.length !== ENVELOPE_KEYS.length || keys.some((key, index) => key !== ENVELOPE_KEYS[index]) ||
    envelope.schemaVersion !== ENVELOPE_SCHEMA ||
    envelope.algorithm !== ALGORITHM ||
    envelope.keyVersion !== 1 ||
    !PURPOSES.has(envelope.purpose) ||
    (expectedPurpose && envelope.purpose !== expectedPurpose) ||
    typeof envelope.iv !== 'string' || base64UrlDecode(envelope.iv).byteLength !== 12 ||
    typeof envelope.ciphertext !== 'string' || base64UrlDecode(envelope.ciphertext).byteLength < 17
  ) {
    throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
  }
}

function canonicalContext(value) {
  const common = {
    aadVersion: 1,
    envelopeSchemaVersion: ENVELOPE_SCHEMA,
    purpose: requireContextValue(value.purpose),
    provider: requireContextValue(value.provider),
    companyId: requireContextValue(value.companyId),
  };
  if (!PURPOSES.has(common.purpose) || common.provider !== META_PROVIDER) {
    throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
  }
  if (common.purpose === 'meta-pending') {
    return Object.freeze({
      ...common,
      actorId: requireContextValue(value.actorId),
      oauthStateId: requireContextValue(value.oauthStateId),
      redirectUri: requireContextValue(value.redirectUri),
    });
  }
  return Object.freeze({
    ...common,
    connectionId: requireContextValue(value.connectionId),
    pageId: requireContextValue(value.pageId),
  });
}

function encodeContext(context) {
  const canonical = canonicalContext(context ?? {});
  return new TextEncoder().encode(JSON.stringify(canonical));
}

async function importKey(encodedKey, usages, cryptoApi) {
  const bytes = decodeEncryptionKey(encodedKey);
  if (bytes.byteLength !== 32) throw new MetaConnectionError('META_NOT_CONFIGURED');
  return cryptoApi.subtle.importKey('raw', bytes, ALGORITHM, false, usages);
}

function requireContextValue(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean || clean.length > 2048 || /[\u0000-\u001f]/.test(clean)) {
    throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
  }
  return clean;
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
