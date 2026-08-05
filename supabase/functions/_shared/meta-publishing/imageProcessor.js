import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { MetaPublishingError, supportedFacebookPhotoMimeTypes } from './contracts.js';

export function createImageScriptProcessor() {
  return {
    async sanitize({ bytes, mimeType, maxBytes, maxPixels, maxWidth, maxHeight }) {
      const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (!supportedFacebookPhotoMimeTypes.has(mimeType)) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
      if (input.byteLength < 1 || input.byteLength > maxBytes) throw new MetaPublishingError('META_PUBLICATION_MEDIA_TOO_LARGE');
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
      return { bytes: output, mimeType, width, height };
    },
  };
}

async function decodeImage(bytes) {
  try {
    return await Image.decode(bytes);
  } catch {
    throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  }
}
