import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  edge,
  service,
  provider,
  contracts,
  privacy,
  client,
  panel,
  migration,
  schema,
  config,
] = await Promise.all([
  read('supabase/functions/meta-social-publish/index.ts'),
  read('supabase/functions/_shared/meta-publishing/service.js'),
  read('supabase/functions/_shared/meta-publishing/provider.js'),
  read('supabase/functions/_shared/meta-publishing/contracts.js'),
  read('supabase/functions/_shared/meta-publishing/privacy.js'),
  read('src/features/meta-publishing/clientApi.ts'),
  read('src/components/portal/FacebookPublishPanel.tsx'),
  read('supabase/migrations/20260803193000_meta_facebook_publish_foundation.sql'),
  read('supabase/schema.sql'),
  read('supabase/config.toml'),
]);

const browserSources = `${client}\n${panel}`;
const serverSources = `${edge}\n${service}\n${provider}\n${contracts}\n${privacy}`;
let checks = 0;
const check = (fn) => { fn(); checks += 1; };

check(() => assert.doesNotMatch(browserSources, /graph\.facebook\.com/i));
check(() => assert.doesNotMatch(browserSources, /access[_-]?token|token_envelope|ciphertext|appsecret_proof/i));
check(() => assert.doesNotMatch(browserSources, /META_APP_SECRET|META_TOKEN_ENCRYPTION_KEY|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/));
check(() => assert.doesNotMatch(browserSources, /company_social_publications/));
check(() => assert.doesNotMatch(browserSources, /providerPostId|provider_post_id|facebookPageId|facebook_page_id/));
check(() => assert.doesNotMatch(browserSources, /instagram_content_publish|publish_instagram/i));
check(() => assert.doesNotMatch(browserSources, /\bFormData\b|upload(?:Photo|Video|Media)|multipart\/form-data/i));
check(() => assert.doesNotMatch(browserSources, /password/i));
check(() => assert.match(client, /supabaseFunction<.*>\(functionName/s));
check(() => assert.match(client, /action: 'publish_facebook_text'/));
check(() => assert.match(client, /explicitApproval: true/));
check(() => assert.match(client, /idempotencyKey: string/));
check(() => assert.match(panel, /crypto\.randomUUID\(\)/));
check(() => assert.match(panel, /workspace\.submitting/));
check(() => assert.match(panel, /invalidateFacebookPublishApproval/));
check(() => assert.match(panel, /Text-only - selected photos and videos will not be uploaded/i));
check(() => assert.match(panel, /META_PUBLICATION_DELIVERY_UNKNOWN|normalizePublishingError/));
check(() => assert.doesNotMatch(panel, /retry/i));

check(() => assert.match(config, /\[functions\.meta-social-publish\]\s+verify_jwt = true/));
check(() => assert.doesNotMatch(config, /\[functions\.meta-social-publish\]\s+verify_jwt = false/));
check(() => assert.match(edge, /const jwt = requireBearerJwt\(authorization\)/));
check(() => assert.match(edge, /auth\.getUser\(jwt\)/));
check(() => assert.match(edge, /requireVerifiedAuthUserId\(authResult\)/));
check(() => assert.match(edge, /app_current_session/));
check(() => assert.match(edge, /can_manage_company/));
check(() => assert.match(edge, /assertMetaAccessRole\(session, companyId\)/));
check(() => assert.doesNotMatch(`${service}\n${contracts}`, /body\.actor|requestBody\.actor|value\.actor/));
check(() => assert.doesNotMatch(edge, /console\.[a-z]+\([^\n]*(authorization|jwt|token|message|page|job)/i));
check(() => assert.match(edge, /Cache-Control': 'no-store'/));

check(() => assert.match(service, /buildPrivateValues\(publicationContext\)/));
check(() => assert.match(service, /assertPublicationPrivacy\(message, privateValues\)/));
check(() => assert.match(service, /decryptTokenBundle/));
check(() => assert.match(service, /connectionEnvelopeContext/));
check(() => assert.match(service, /beginPublication/));
check(() => assert.match(service, /if \(!beginning\.should_publish\)/));
check(() => assert.match(service, /markUnknown/));
check(() => assert.match(service, /META_PUBLICATION_DELIVERY_UNKNOWN/));
check(() => assert.match(service, /maxBodyBytes/));
check(() => assert.match(contracts, /new TextEncoder\(\)\.encode\(rawBody\)\.byteLength > maxBytes/));
check(() => assert.match(contracts, /clean\.length > 5000/));
check(() => assert.match(contracts, /value !== true/));
check(() => assert.match(contracts, /\['action', 'companyId', 'jobId', 'message', 'idempotencyKey', 'explicitApproval'\]/));
check(() => assert.doesNotMatch(contracts, /scheduled|instagram|mediaIds|pageId|connectionId/));

check(() => assert.match(provider, /https:\/\/graph\.facebook\.com\/\$\{config\.graphApiVersion\}/));
check(() => assert.match(provider, /Authorization: `Bearer \$\{pageAccessToken\}`/));
check(() => assert.match(provider, /'Content-Type': 'application\/x-www-form-urlencoded'/));
check(() => assert.match(provider, /new URLSearchParams\(\{ message, appsecret_proof: proof \}\)/));
check(() => assert.doesNotMatch(provider, /access_token/));
check(() => assert.doesNotMatch(provider, /searchParams|\?access/));
check(() => assert.doesNotMatch(provider, /for\s*\(|while\s*\(|setInterval|setTimeout/));
check(() => assert.doesNotMatch(provider, /console\./));
check(() => assert.doesNotMatch(provider, /rawMessage|fbtrace_id|x-fb-debug/));
check(() => assert.doesNotMatch(provider, /return\s*\{[^}]*\b(?:message|payload|response|request|body|url|pageId)\s*:/s));
check(() => assert.match(provider, /RESPONSE_MISSING_POST_ID/));

check(() => assert.match(migration, /alter table public\.company_social_publications enable row level security/));
check(() => assert.match(migration, /revoke all on public\.company_social_publications from public, anon, authenticated/));
check(() => assert.match(migration, /grant select, insert, update on public\.company_social_publications to service_role/));
check(() => assert.doesNotMatch(migration, /grant[^;]+company_social_publications[^;]+(?:anon|authenticated)/i));
check(() => assert.match(migration, /unique index company_social_publications_company_idempotency_unique/));
check(() => assert.match(migration, /status in \('publishing', 'published', 'failed', 'delivery_unknown'\)/));
check(() => assert.match(migration, /octet_length\(message_sha256\) = 32/));
check(() => assert.match(migration, /sha256\(convert_to\(p_approved_message, 'UTF8'\)\)/));
check(() => assert.match(migration, /char_length\(approved_message\) between 1 and 5000/));
check(() => assert.match(migration, /lower\(approved_message\) not like '%\[private\]%'/));
check(() => assert.match(migration, /attempts between 0 and 1/));
check(() => assert.match(migration, /meta_publication_started/));
check(() => assert.match(migration, /meta_publication_published/));
check(() => assert.match(migration, /meta_publication_failed/));
check(() => assert.match(migration, /meta_publication_delivery_unknown/));
check(() => assert.doesNotMatch(migration, /raw provider|access token|app secret|fbtrace/i));
check(() => assert.match(schema, /-- META_FACEBOOK_PUBLISH_SCHEMA_BEGIN/));
check(() => assert.match(schema, /-- META_FACEBOOK_PUBLISH_SCHEMA_END/));

const telemetryShape = service.match(/safePublishingTelemetry\(\{([\s\S]*?)\}\)/g) ?? [];
check(() => assert.ok(telemetryShape.length >= 3));
for (const shape of telemetryShape) {
  check(() => assert.doesNotMatch(shape, /\b(?:message|messageSha256|pageId|jobId|publicationId|actorId|token|endpoint|request|response|body)\s*:/));
}

const distPath = new URL('../dist', import.meta.url);
if (await exists(distPath)) {
  const bundle = await readTree(fileURLToPath(distPath));
  for (const forbidden of [
    /META_APP_SECRET/,
    /META_TOKEN_ENCRYPTION_KEY/,
    /SUPABASE_SERVICE_ROLE_KEY/,
    /fake-page-token-sensitive/,
    /appsecret_proof/,
    /company_social_publications/,
  ]) {
    check(() => assert.doesNotMatch(bundle, forbidden));
  }
}

console.log(`Meta publishing security scan passed: ${checks}`);

async function exists(url) {
  try { await stat(url); return true; } catch { return false; }
}

async function readTree(directory) {
  let output = '';
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output += await readTree(path);
    else if (/\.(?:js|css|html|map)$/i.test(entry.name)) output += await readFile(path, 'utf8');
  }
  return output;
}
