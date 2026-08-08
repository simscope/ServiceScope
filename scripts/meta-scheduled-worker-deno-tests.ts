import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  authorizeScheduledWorkerRequest,
  handleScheduledWorkerRequest,
} from '../supabase/functions/_shared/meta-publishing/scheduledWorkerAuth.js';

const secret = `sb_secret_${'d'.repeat(48)}`;
const base = {
  method: 'POST',
  rawBody: '{}',
  apiKey: secret,
  authorization: '',
  secretKeysJson: JSON.stringify({ 'meta-scheduled-publisher': secret }),
  cryptoApi: crypto,
};

Deno.test('scheduled worker rejects browser and invalid credentials before dependencies', async () => {
  let dependencyCalls = 0;
  await assertRejects(
    () => handleScheduledWorkerRequest({
      ...base,
      apiKey: 'sb_publishable_browser',
      authorization: 'Bearer user.jwt.value',
      createDependencies: () => { dependencyCalls += 1; return {}; },
      run: async () => ({}),
    }),
    Error,
    'AUTH_REQUIRED',
  );
  assertEquals(dependencyCalls, 0);
});

Deno.test('scheduled worker accepts only its named secret and empty body', async () => {
  const authorized = await authorizeScheduledWorkerRequest({ ...base, rawBody: '' });
  assertEquals(authorized.workerSecretKey, secret);
  await assertRejects(
    () => authorizeScheduledWorkerRequest({ ...base, rawBody: '{"limit":3}' }),
    Error,
    'INVALID_REQUEST',
  );
});
