export function assertNoPrivateValues(value, privateValues) {
  const text = JSON.stringify(value);
  for (const privateValue of privateValues) {
    const clean = String(privateValue ?? '').trim();
    if (clean.length > 1 && new RegExp(escapeRegExp(clean), 'i').test(text)) {
      throw new Error('MEDIA_PRIVACY_VALIDATION_FAILED');
    }
  }
}

export function assertNoUnsafeClientMediaInput(request) {
  const text = JSON.stringify(request);
  if (/https?:\/\/|data:|base64|signedUrl|storagePath|storageBucket|providerPrompt|prompt/i.test(text)) {
    throw new Error('INVALID_REQUEST');
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
