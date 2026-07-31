import { MetaConnectionError } from './contracts.js';

const ENVELOPE_SCHEMA = 'encrypted-social-token-v1';
const ALGORITHM = 'AES-GCM';

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

export async function encryptTokenBundle(value, encodedKey, cryptoApi = globalThis.crypto) {
  const key = await importKey(encodedKey, ['encrypt'], cryptoApi);
  const iv = new Uint8Array(12);
  cryptoApi.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await cryptoApi.subtle.encrypt({ name: ALGORITHM, iv }, key, plaintext);
  return {
    schemaVersion: ENVELOPE_SCHEMA,
    algorithm: ALGORITHM,
    keyVersion: 1,
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  };
}

export async function decryptTokenBundle(envelope, encodedKey, cryptoApi = globalThis.crypto) {
  try {
    assertEnvelope(envelope);
    const key = await importKey(encodedKey, ['decrypt'], cryptoApi);
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: ALGORITHM, iv: base64UrlDecode(envelope.iv) },
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

export function assertEnvelope(envelope) {
  if (
    !envelope || typeof envelope !== 'object' ||
    envelope.schemaVersion !== ENVELOPE_SCHEMA ||
    envelope.algorithm !== ALGORITHM ||
    envelope.keyVersion !== 1 ||
    typeof envelope.iv !== 'string' || base64UrlDecode(envelope.iv).byteLength !== 12 ||
    typeof envelope.ciphertext !== 'string' || base64UrlDecode(envelope.ciphertext).byteLength < 17
  ) {
    throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
  }
}

async function importKey(encodedKey, usages, cryptoApi) {
  const bytes = decodeKey(encodedKey);
  if (bytes.byteLength !== 32) throw new MetaConnectionError('META_NOT_CONFIGURED');
  return cryptoApi.subtle.importKey('raw', bytes, ALGORITHM, false, usages);
}

function decodeKey(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  try {
    return base64UrlDecode(clean.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  } catch {
    throw new MetaConnectionError('META_NOT_CONFIGURED');
  }
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
