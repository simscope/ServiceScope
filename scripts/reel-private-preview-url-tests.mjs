import assert from 'node:assert/strict';
import { createSupabaseHttpClient } from '../server/reel-render-jobs/supabaseHttp.js';

const origin = 'https://example.supabase.co';
const object = 'company/render/reel.mp4';
const relative = `/object/sign/company-reel-renders/${object}`;
const query = '?token=a%2Fb%2Bc%3D&download=clip%20name.mp4';
const expected = `${origin}/storage/v1${relative}${query}`;

async function sign(signedURL) {
  const client = createSupabaseHttpClient({
    SUPABASE_URL: origin, SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture',
  }, async (url, options) => {
    assert.equal(url, `${origin}/storage/v1${relative}`);
    assert.equal(options.method, 'POST');
    return Response.json({ signedURL });
  });
  return (await client.sign('company-reel-renders', object, 300)).signedURL;
}

for (const value of [relative + query, '/storage/v1' + relative + query, expected]) {
  assert.equal(await sign(value), expected);
}
for (const value of [
  `https://other.supabase.co/storage/v1${relative}${query}`,
  `http://example.supabase.co/storage/v1${relative}${query}`,
  `//other.supabase.co/storage/v1${relative}${query}`,
  `https://user:password@example.supabase.co/storage/v1${relative}${query}`,
  `/storage/v1${relative.replace('/render/', '/another-render/')}${query}`,
  `/storage/v1/storage/v1${relative}${query}`,
  `/storage/v1${relative}`, `${expected}#fragment`,
]) {
  await assert.rejects(sign(value), { code: 'REEL_RENDER_SERVICE_UNAVAILABLE' });
}
console.log('PASS: 3 supported forms preserve signature; 8 unsafe or mismatched forms rejected.');
