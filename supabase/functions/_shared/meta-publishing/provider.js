import { appSecretProof } from '../meta-connection/provider.js';
import { MetaPublishingError, sanitizeProviderDiagnostic } from './contracts.js';

export function createFacebookPublishingProvider({ config, fetchImpl = globalThis.fetch, cryptoApi = globalThis.crypto }) {
  return {
    async publishText({ pageId, pageAccessToken, message, signal }) {
      const endpoint = `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(pageId)}/feed`;
      const proof = await appSecretProof(pageAccessToken, config.appSecret, cryptoApi);
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${pageAccessToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ message, appsecret_proof: proof }),
          signal,
        });
      } catch {
        throw new MetaPublishingError('META_PUBLICATION_DELIVERY_UNKNOWN', undefined, {
          providerCategory: 'DELIVERY_UNKNOWN',
        });
      }

      const payload = await readBoundedJson(response);
      if (!response.ok) {
        throw new MetaPublishingError('META_PUBLICATION_PROVIDER_REJECTED', undefined, providerDiagnostic(payload, response.status));
      }
      const providerPostId = typeof payload?.id === 'string' ? payload.id.trim() : '';
      if (!providerPostId || providerPostId.length > 200 || /[\u0000-\u001f]/.test(providerPostId)) {
        throw new MetaPublishingError('META_PUBLICATION_FAILED', undefined, {
          providerCategory: 'RESPONSE_MISSING_POST_ID',
        });
      }
      return { providerPostId };
    },

    async publishSinglePhoto({ pageId, pageAccessToken, message, photoBytes, mimeType, signal }) {
      const endpoint = `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(pageId)}/photos`;
      const proof = await appSecretProof(pageAccessToken, config.appSecret, cryptoApi);
      const form = new FormData();
      form.set('caption', message);
      form.set('published', 'true');
      form.set('appsecret_proof', proof);
      form.set('source', new Blob([photoBytes], { type: mimeType }), 'servicescope-photo');
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${pageAccessToken}`,
            Accept: 'application/json',
          },
          body: form,
          signal,
        });
      } catch {
        throw new MetaPublishingError('META_PUBLICATION_DELIVERY_UNKNOWN', undefined, {
          providerCategory: 'DELIVERY_UNKNOWN',
        });
      }

      const payload = await readBoundedJson(response);
      if (!response.ok) {
        throw new MetaPublishingError('META_PUBLICATION_PROVIDER_REJECTED', undefined, providerDiagnostic(payload, response.status));
      }
      const providerMediaId = typeof payload?.id === 'string' ? payload.id.trim() : '';
      if (!providerMediaId || providerMediaId.length > 200 || /[\u0000-\u001f]/.test(providerMediaId)) {
        throw new MetaPublishingError('META_PUBLICATION_FAILED', undefined, {
          providerCategory: 'RESPONSE_MISSING_MEDIA_ID',
        });
      }
      return { providerPostId: null, providerMediaId };
    },

    async initializeReel({ pageId, pageAccessToken, signal }) {
      const endpoint = `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(pageId)}/video_reels`;
      const proof = await appSecretProof(pageAccessToken, config.appSecret, cryptoApi);
      const payload = await requestProviderJson(fetchImpl, endpoint, {
        method: 'POST',
        headers: providerFormHeaders(pageAccessToken),
        body: new URLSearchParams({ upload_phase: 'start', appsecret_proof: proof }),
        signal,
      });
      const providerMediaId = safeProviderId(payload?.video_id);
      if (!providerMediaId) {
        throw new MetaPublishingError('META_PUBLICATION_FAILED', undefined, {
          providerCategory: 'RESPONSE_MISSING_MEDIA_ID',
        });
      }
      return { providerMediaId };
    },

    async uploadReel({ providerMediaId, pageAccessToken, videoBytes, signal }) {
      const endpoint = `https://rupload.facebook.com/video-upload/${config.graphApiVersion}/${encodeURIComponent(providerMediaId)}`;
      const response = await requestProviderJson(fetchImpl, endpoint, {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${pageAccessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/octet-stream',
          offset: '0',
          file_size: String(videoBytes.byteLength),
        },
        body: videoBytes,
        signal,
      });
      if (response?.success !== true) {
        throw new MetaPublishingError('META_PUBLICATION_FAILED', undefined, {
          providerCategory: 'PROVIDER_REJECTED',
        });
      }
      return { uploaded: true };
    },

    async finalizeReel({ pageId, pageAccessToken, providerMediaId, message, signal }) {
      const endpoint = `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(pageId)}/video_reels`;
      const proof = await appSecretProof(pageAccessToken, config.appSecret, cryptoApi);
      const payload = await requestProviderJson(fetchImpl, endpoint, {
        method: 'POST',
        headers: providerFormHeaders(pageAccessToken),
        body: new URLSearchParams({
          upload_phase: 'finish',
          video_state: 'PUBLISHED',
          video_id: providerMediaId,
          description: message,
          appsecret_proof: proof,
        }),
        signal,
      });
      if (payload?.success !== true) {
        throw new MetaPublishingError('META_PUBLICATION_FAILED', undefined, {
          providerCategory: 'PROVIDER_REJECTED',
        });
      }
      return { finalized: true };
    },

    async getReelStatus({ providerMediaId, pageAccessToken, signal }) {
      const proof = await appSecretProof(pageAccessToken, config.appSecret, cryptoApi);
      const endpoint = new URL(`https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(providerMediaId)}`);
      endpoint.search = new URLSearchParams({ fields: 'status', appsecret_proof: proof }).toString();
      const payload = await requestProviderJson(fetchImpl, endpoint.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${pageAccessToken}`, Accept: 'application/json' },
        signal,
      });
      return normalizeReelStatus(payload?.status);
    },
  };
}

function providerFormHeaders(pageAccessToken) {
  return {
    Authorization: `Bearer ${pageAccessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

async function requestProviderJson(fetchImpl, endpoint, init) {
  let response;
  try {
    response = await fetchImpl(endpoint, init);
  } catch {
    throw new MetaPublishingError('META_PUBLICATION_DELIVERY_UNKNOWN', undefined, {
      providerCategory: 'DELIVERY_UNKNOWN',
    });
  }
  const payload = await readBoundedJson(response);
  if (!response.ok) {
    throw new MetaPublishingError('META_PUBLICATION_PROVIDER_REJECTED', undefined, providerDiagnostic(payload, response.status));
  }
  return payload;
}

function normalizeReelStatus(value) {
  const publishing = String(value?.publishing_phase?.status ?? '').toLowerCase();
  const processing = String(value?.processing_phase?.status ?? '').toLowerCase();
  const video = String(value?.video_status ?? '').toLowerCase();
  const hasError = Boolean(value?.publishing_phase?.error || value?.processing_phase?.error || value?.uploading_phase?.error);
  if (hasError || ['error', 'failed'].includes(publishing) || ['error', 'failed'].includes(processing) || ['error', 'failed'].includes(video)) {
    return { state: 'failed' };
  }
  if (publishing === 'complete' || ['published', 'ready'].includes(video)) return { state: 'published' };
  return { state: 'processing' };
}

function safeProviderId(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean && clean.length <= 200 && !/[\u0000-\u001f]/.test(clean) ? clean : null;
}

function providerDiagnostic(payload, httpStatus) {
  const providerCode = safeInteger(payload?.error?.code);
  const providerSubcode = safeInteger(payload?.error?.error_subcode);
  const providerIsTransient = typeof payload?.error?.is_transient === 'boolean' ? payload.error.is_transient : null;
  let providerCategory = 'PROVIDER_REJECTED';
  if (httpStatus === 401 || providerCode === 190) providerCategory = 'INVALID_TOKEN';
  else if ([10, 200].includes(providerCode)) providerCategory = 'MISSING_PERMISSION';
  else if (httpStatus === 404 || providerCode === 100) providerCategory = 'PAGE_UNAVAILABLE';
  else if (httpStatus === 429 || [4, 17, 32, 613].includes(providerCode)) providerCategory = 'RATE_LIMITED';
  else if (httpStatus >= 500 || providerIsTransient === true) providerCategory = 'PROVIDER_TEMPORARY_ERROR';
  return sanitizeProviderDiagnostic({
    providerHttpStatus: httpStatus,
    providerCode,
    providerSubcode,
    providerCategory,
    providerIsTransient,
  });
}

async function readBoundedJson(response) {
  try {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 65_536) return {};
    const value = JSON.parse(text || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function safeInteger(value) {
  return Number.isInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647 ? value : null;
}
