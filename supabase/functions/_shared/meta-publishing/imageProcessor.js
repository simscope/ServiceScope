import { MetaPublishingError, supportedFacebookPhotoMimeTypes } from './contracts.js';

let imageScriptModule;

export function createImageScriptProcessor() {
  return {
    async sanitize({ bytes, mimeType, maxBytes, maxPixels, maxWidth, maxHeight }) {
      const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (!supportedFacebookPhotoMimeTypes.has(mimeType)) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
      if (input.byteLength < 1 || input.byteLength > maxBytes) throw new MetaPublishingError('META_PUBLICATION_MEDIA_TOO_LARGE');
      const preflight = inspectImageHeader(input);
      if (preflight.mimeType !== mimeType) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
      if (preflight.width > maxWidth || preflight.height > maxHeight || preflight.width * preflight.height > maxPixels) {
        throw new MetaPublishingError('META_PUBLICATION_MEDIA_TOO_LARGE');
      }
      const image = await decodeImage(input);
      const width = Number(image?.width);
      const height = Number(image?.height);
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
      }
      if (width > maxWidth || height > maxHeight || width * height > maxPixels) {
        throw new MetaPublishingError('META_PUBLICATION_MEDIA_TOO_LARGE');
      }
      const output = mimeType === 'image/png'
        ? new Uint8Array(await image.encode())
        : new Uint8Array(await image.encodeJPEG(90));
      if (output.byteLength < 1 || output.byteLength > maxBytes) throw new MetaPublishingError('META_PUBLICATION_MEDIA_TOO_LARGE');
      const outputPreflight = inspectImageHeader(output);
      return {
        bytes: output,
        mimeType: outputPreflight.mimeType,
        detectedMimeType: preflight.mimeType,
        width,
        height,
        originalByteSize: input.byteLength,
        sanitizedByteSize: output.byteLength,
        metadataStripped: true,
        gpsStripped: true,
        sanitizer: 'ImageScript',
        sanitizerVersion: '1.3.0',
      };
    },
  };
}

export function inspectImageHeader(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (isPng(input)) return inspectPng(input);
  if (input[0] === 0xff && input[1] === 0xd8) return inspectJpeg(input);
  throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
}

function inspectPng(input) {
  if (input.length < 33 || !isPng(input)) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  const ihdrLength = readU32(input, 8);
  const ihdrType = ascii(input, 12, 16);
  if (ihdrLength !== 13 || ihdrType !== 'IHDR') throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  const width = readU32(input, 16);
  const height = readU32(input, 20);
  if (width < 1 || height < 1) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  let offset = 8;
  let chunks = 0;
  while (offset + 12 <= input.length && chunks < 256 && offset < 1_048_576) {
    const length = readU32(input, offset);
    const type = ascii(input, offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > input.length) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
    if (type === 'IEND') return { mimeType: 'image/png', width, height };
    offset = end;
    chunks += 1;
  }
  throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
}

function inspectJpeg(input) {
  let offset = 2;
  let segments = 0;
  while (offset + 4 <= input.length && segments < 512 && offset < 1_048_576) {
    if (input[offset] !== 0xff) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
    let marker = input[offset + 1];
    while (marker === 0xff && offset + 2 < input.length) {
      offset += 1;
      marker = input[offset + 1];
    }
    if (marker === 0xd9) break;
    if (marker === 0xda) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
    const length = (input[offset + 2] << 8) + input[offset + 3];
    if (length < 2 || offset + 2 + length > input.length) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
    if (isSof(marker)) {
      if (length < 7) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
      const height = (input[offset + 5] << 8) + input[offset + 6];
      const width = (input[offset + 7] << 8) + input[offset + 8];
      if (width < 1 || height < 1) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
      return { mimeType: 'image/jpeg', width, height };
    }
    offset += 2 + length;
    segments += 1;
  }
  throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
}

function isSof(marker) {
  return (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker));
}

function isPng(input) {
  return input.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => input[index] === byte);
}

function readU32(input, offset) {
  return ((input[offset] << 24) | (input[offset + 1] << 16) | (input[offset + 2] << 8) | input[offset + 3]) >>> 0;
}

function ascii(input, start, end) {
  return String.fromCharCode(...input.slice(start, end));
}

async function decodeImage(bytes) {
  try {
    const { Image } = await loadImageScript();
    return await Image.decode(bytes);
  } catch {
    throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  }
}

async function loadImageScript() {
  imageScriptModule ??= import('https://deno.land/x/imagescript@1.3.0/mod.ts');
  return imageScriptModule;
}
