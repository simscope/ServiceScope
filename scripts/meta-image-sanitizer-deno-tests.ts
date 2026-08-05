import { assert, assertEquals, assertNotEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { createImageScriptProcessor } from '../supabase/functions/_shared/meta-publishing/imageProcessor.js';
import { createFacebookPublishingProvider } from '../supabase/functions/_shared/meta-publishing/provider.js';

const processor = createImageScriptProcessor();
const limits = { maxBytes: 12_000_000, maxPixels: 40_000_000, maxWidth: 10_000, maxHeight: 10_000 };

Deno.test('production ImageScript sanitizer decodes and strips JPEG metadata fixtures', async () => {
  const clean = await jpegFixture(3, 2);
  const withMetadata = injectJpegMetadata(clean, [
    exifSegment('Exif\0\0Synthetic camera'),
    exifSegment('GPS\0\0Synthetic coordinates'),
    app1Segment('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>synthetic</x:xmpmeta>'),
  ]);
  const original = new Uint8Array(withMetadata);
  const sanitized = await processor.sanitize({ bytes: withMetadata, mimeType: 'image/jpeg', ...limits });
  const decoded = await Image.decode(sanitized.bytes);

  assertEquals(decoded.width, 3);
  assertEquals(decoded.height, 2);
  assertEquals(sanitized.mimeType, 'image/jpeg');
  assertEquals(sanitized.detectedMimeType, 'image/jpeg');
  assertEquals(sanitized.sanitizer, 'ImageScript');
  assertEquals(sanitized.sanitizerVersion, '1.3.0');
  assertEquals(withMetadata, original);
  assertNotEquals(await sha256Hex(sanitized.bytes), await sha256Hex(withMetadata));
  assert(!containsAscii(sanitized.bytes, 'Exif'));
  assert(!containsAscii(sanitized.bytes, 'GPS'));
  assert(!containsAscii(sanitized.bytes, 'xmpmeta'));
  assert(sanitized.bytes.byteLength <= limits.maxBytes);
});

Deno.test('production ImageScript sanitizer decodes and strips PNG text metadata', async () => {
  const clean = await pngFixture(4, 3);
  const withText = injectPngText(clean, 'Comment', 'Synthetic private-free metadata');
  const original = new Uint8Array(withText);
  const sanitized = await processor.sanitize({ bytes: withText, mimeType: 'image/png', ...limits });
  const decoded = await Image.decode(sanitized.bytes);

  assertEquals(decoded.width, 4);
  assertEquals(decoded.height, 3);
  assertEquals(sanitized.mimeType, 'image/png');
  assertEquals(sanitized.detectedMimeType, 'image/png');
  assertEquals(withText, original);
  assertNotEquals(await sha256Hex(sanitized.bytes), await sha256Hex(withText));
  assert(!containsAscii(sanitized.bytes, 'Comment'));
  assert(!containsAscii(sanitized.bytes, 'Synthetic private-free metadata'));
});

Deno.test('predecode rejects malformed, mismatched, unsupported, and oversized fixtures before provider use', async () => {
  const providerCalls: Uint8Array[] = [];
  const cases: Array<{ bytes: Uint8Array; mimeType: string }> = [
    { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00]), mimeType: 'image/jpeg' },
    { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xda]), mimeType: 'image/jpeg' },
    { bytes: malformedPng(), mimeType: 'image/png' },
    { bytes: jpegHeader(10_001, 1), mimeType: 'image/jpeg' },
    { bytes: pngHeader(10_001, 1), mimeType: 'image/png' },
    { bytes: jpegHeader(8_000, 6_000), mimeType: 'image/jpeg' },
    { bytes: await jpegFixture(1, 1), mimeType: 'image/png' },
    { bytes: await pngFixture(1, 1), mimeType: 'image/jpeg' },
    { bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), mimeType: 'image/gif' },
    { bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), mimeType: 'image/webp' },
    { bytes: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), mimeType: 'video/mp4' },
  ];

  for (const entry of cases) {
    const original = new Uint8Array(entry.bytes);
    await assertRejects(
      () => processor.sanitize({ bytes: entry.bytes, mimeType: entry.mimeType, ...limits }),
      Error,
      'META_PUBLICATION_MEDIA_',
    );
    assertEquals(entry.bytes, original);
  }
  assertEquals(providerCalls.length, 0);
});

Deno.test('production sanitizer output is the exact multipart provider payload', async () => {
  const clean = await jpegFixture(2, 2);
  const withMetadata = injectJpegMetadata(clean, [
    exifSegment('Exif\0\0Synthetic camera'),
    exifSegment('GPS\0\0Synthetic coordinates'),
    app1Segment('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>synthetic</x:xmpmeta>'),
  ]);
  const original = new Uint8Array(withMetadata);
  const sanitized = await processor.sanitize({ bytes: withMetadata, mimeType: 'image/jpeg', ...limits });
  const calls: Array<{ caption: string; published: string; source: File }> = [];
  const provider = createFacebookPublishingProvider({
    config: { graphApiVersion: 'v25.0', appSecret: 'test-secret' },
    cryptoApi: crypto,
    fetchImpl: async (_input: string | Request | URL, init?: RequestInit) => {
      assert(init);
      const form = init.body as FormData;
      calls.push({
        caption: String(form.get('caption')),
        published: String(form.get('published')),
        source: form.get('source') as File,
      });
      return new Response(JSON.stringify({ id: '10001_photo_30003' }), { status: 200 });
    },
  });

  const result = await provider.publishSinglePhoto({
    pageId: '10001',
    pageAccessToken: 'page-token',
    message: 'Exact reviewed message.',
    photoBytes: sanitized.bytes,
    mimeType: sanitized.mimeType,
    signal: new AbortController().signal,
  });

  assertEquals(result.providerMediaId, '10001_photo_30003');
  assertEquals(calls.length, 1);
  assertEquals(calls[0].caption, 'Exact reviewed message.');
  assertEquals(calls[0].published, 'true');
  assertEquals(calls[0].source.type, 'image/jpeg');
  const multipartBytes = new Uint8Array(await calls[0].source.arrayBuffer());
  assertEquals(multipartBytes, sanitized.bytes);
  assertNotEquals(await sha256Hex(multipartBytes), await sha256Hex(original));
  assertEquals(withMetadata, original);
  assert(!containsAscii(multipartBytes, 'Exif'));
  assert(!containsAscii(multipartBytes, 'GPS'));
  assert(!containsAscii(multipartBytes, 'xmpmeta'));
});

async function jpegFixture(width: number, height: number) {
  const image = new Image(width, height);
  image.fill(0xff3366ff);
  return new Uint8Array(await image.encodeJPEG(90));
}

async function pngFixture(width: number, height: number) {
  const image = new Image(width, height);
  image.fill(0x33ff66ff);
  return new Uint8Array(await image.encode());
}

function injectJpegMetadata(bytes: Uint8Array, segments: Uint8Array[]) {
  return concat([bytes.slice(0, 2), ...segments, bytes.slice(2)]);
}

function exifSegment(text: string) {
  return app1Segment(text);
}

function app1Segment(text: string) {
  const payload = new TextEncoder().encode(text);
  const length = payload.length + 2;
  return concat([new Uint8Array([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff]), payload]);
}

function injectPngText(bytes: Uint8Array, keyword: string, text: string) {
  const payload = new TextEncoder().encode(`${keyword}\0${text}`);
  const length = u32(payload.length);
  const type = new TextEncoder().encode('tEXt');
  const crc = u32(0);
  return concat([bytes.slice(0, 33), length, type, payload, crc, bytes.slice(33)]);
}

function jpegHeader(width: number, height: number) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
    0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
  ]);
}

function pngHeader(width: number, height: number) {
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13),
    new TextEncoder().encode('IHDR'),
    u32(width),
    u32(height),
    new Uint8Array([8, 2, 0, 0, 0, 0, 0, 0, 0]),
    u32(0),
    new TextEncoder().encode('IEND'),
    u32(0),
  ]);
}

function malformedPng() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48]);
}

function u32(value: number) {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function concat(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function containsAscii(bytes: Uint8Array, needle: string) {
  return new TextDecoder().decode(bytes).includes(needle);
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
