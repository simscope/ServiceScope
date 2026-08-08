import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  SCHEDULED_WORKER_SECRET_NAME,
  authorizeScheduledWorkerRequest,
  handleScheduledWorkerRequest,
} from '../supabase/functions/_shared/meta-publishing/scheduledWorkerAuth.js';

const secret = `sb_secret_${'d'.repeat(48)}`;
const base = {
  method: 'POST',
  rawBody: '{}',
  apiKey: secret,
  authorization: '',
  secretKeysJson: JSON.stringify({ [SCHEDULED_WORKER_SECRET_NAME]: secret }),
  cryptoApi: crypto,
};

assertEquals(SCHEDULED_WORKER_SECRET_NAME, 'meta_scheduled_publisher');

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
    () => authorizeScheduledWorkerRequest({
      ...base,
      secretKeysJson: JSON.stringify({ meta_scheduled_publishers: secret }),
    }),
    Error,
    'WORKER_NOT_CONFIGURED',
  );
  await assertRejects(
    () => authorizeScheduledWorkerRequest({ ...base, apiKey: `sb_secret_${'e'.repeat(48)}` }),
    Error,
    'AUTH_REQUIRED',
  );
  await assertRejects(
    () => authorizeScheduledWorkerRequest({ ...base, rawBody: '{"limit":3}' }),
    Error,
    'INVALID_REQUEST',
  );
});
