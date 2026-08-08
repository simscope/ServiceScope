import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runtimePublishingConfig } from '../_shared/meta-publishing/contracts.js';
import { createImageScriptProcessor } from '../_shared/meta-publishing/imageProcessor.js';
import { createFacebookPublishingProvider } from '../_shared/meta-publishing/provider.js';
import { createScheduledPublishingRepository } from '../_shared/meta-publishing/scheduledRepository.js';
import { runScheduledFacebookWorker } from '../_shared/meta-publishing/scheduledWorker.js';
import {
  ScheduledWorkerRequestError,
  handleScheduledWorkerRequest,
} from '../_shared/meta-publishing/scheduledWorkerAuth.js';
import { createTimeoutController } from '../_shared/meta-publishing/service.js';

Deno.serve(async (request) => {
  try {
    const result = await handleScheduledWorkerRequest({
      method: request.method,
      rawBody: await request.text(),
      apiKey: request.headers.get('apikey') ?? '',
      authorization: request.headers.get('Authorization') ?? '',
      secretKeysJson: Deno.env.get('SUPABASE_SECRET_KEYS') ?? '',
      cryptoApi: globalThis.crypto,
      createDependencies,
      run: runScheduledFacebookWorker,
    });
    return jsonResponse(result, 200);
  } catch (error) {
    const normalized = normalizeWorkerError(error);
    return jsonResponse({ error: 'Scheduled publishing worker request was rejected.', code: normalized.code }, normalized.status);
  }
});

function createDependencies(workerSecretKey: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !workerSecretKey || !serviceRoleKey) {
    throw new ScheduledWorkerRequestError('WORKER_NOT_CONFIGURED', 500);
  }
  const config = runtimePublishingConfig((key: string) => Deno.env.get(key));
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  return {
    repository: createScheduledPublishingRepository(adminClient),
    provider: createFacebookPublishingProvider({ config }),
    imageProcessor: createImageScriptProcessor(),
    config,
    cryptoApi: globalThis.crypto,
    timeoutController: createTimeoutController,
    now: () => Date.now(),
  };
}

function normalizeWorkerError(error: unknown) {
  if (error instanceof ScheduledWorkerRequestError) return error;
  if (error && typeof error === 'object' && (error as { code?: string }).code === 'META_PUBLISH_NOT_CONFIGURED') {
    return new ScheduledWorkerRequestError('META_PUBLISH_NOT_CONFIGURED', 500);
  }
  return new ScheduledWorkerRequestError('INTERNAL_ERROR', 500);
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
    },
  });
}
