import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const clientFiles = [
  'src/features/meta-connection/contracts.ts',
  'src/features/meta-connection/clientApi.ts',
  'src/features/meta-connection/callback.ts',
  'src/features/meta-connection/MetaOAuthCallbackPage.tsx',
  'src/features/meta-connection/SocialConnectionsPanel.tsx',
  'src/features/meta-connection/useMetaSocialConnection.ts',
];
const serverFiles = [
  'supabase/functions/meta-social-connection/index.ts',
  'supabase/functions/_shared/meta-connection/contracts.js',
  'supabase/functions/_shared/meta-connection/crypto.js',
  'supabase/functions/_shared/meta-connection/provider.js',
  'supabase/functions/_shared/meta-connection/rateLimit.js',
  'supabase/functions/_shared/meta-connection/service.js',
];
const clientSource = (await Promise.all(clientFiles.map(read))).join('\n');
const serverSource = (await Promise.all(serverFiles.map(read))).join('\n');
const featureSource = `${clientSource}\n${serverSource}`;
const migration = await read('supabase/migrations/20260731220000_meta_social_connection_foundation.sql');
const canonicalSchema = await read('supabase/schema.sql');
const config = await read('supabase/config.toml');
const appSource = await read('src/App.tsx');
const onboardingSource = await read('src/components/portal/OnboardingPage.tsx');
const restrictedSource = await read('src/features/company-voice/CompanyVoiceSettingsPage.tsx');
const callbackSource = await read('src/features/meta-connection/callback.ts');
const accessSource = await read('src/features/company-portal/companySettingsAccess.ts');
const providerSource = await read('supabase/functions/_shared/meta-connection/provider.js');
const serviceSource = await read('supabase/functions/_shared/meta-connection/service.js');
const edgeSource = await read('supabase/functions/meta-social-connection/index.ts');
const cryptoSource = await read('supabase/functions/_shared/meta-connection/crypto.js');
const vercelConfig = await read('vercel.json');
let checks = 0;
const check = (fn) => { fn(); checks += 1; };

for (const forbidden of [
  /\/feed\b/i,
  /\/photos\b/i,
  /\/videos\b/i,
  /\/media_publish\b/i,
  /pages_manage_posts/i,
  /instagram_content_publish/i,
  /instagram_business_content_publish/i,
  /pages_manage_metadata/i,
  /business_management/i,
  /pages_messaging/i,
  /publish now/i,
  /\bschedule\b/i,
  /publish queue/i,
  /background worker/i,
  /\bcron\b/i,
]) {
  check(() => assert.doesNotMatch(featureSource, forbidden));
}

for (const secretName of [/VITE_META_APP_SECRET/, /VITE_META_LOGIN_CONFIGURATION_ID/, /VITE_META_TOKEN/, /VITE_META.*ENCRYPTION/i]) {
  check(() => assert.doesNotMatch(featureSource, secretName));
}

for (const forbiddenClientTerm of [
  /META_APP_SECRET/,
  /META_TOKEN_ENCRYPTION_KEY/,
  /token_envelope/,
  /encrypted_pending_token_bundle/,
  /ciphertext/,
  /pageAccessToken/,
  /userAccessToken/,
  /appsecret_proof/,
]) {
  check(() => assert.doesNotMatch(clientSource, forbiddenClientTerm));
}

check(() => assert.match(clientSource, /history\.replaceState/));
check(() => assert.match(callbackSource, /replaceState\(null, '', META_CALLBACK_PATH\)/));
check(() => assert.doesNotMatch(callbackSource, /localStorage|sessionStorage|console\./));
check(() => assert.match(appSource, /consumeMetaOAuthCallbackLocation/));
check(() => assert.deepEqual(JSON.parse(vercelConfig).rewrites, [{ source: '/auth/meta/callback', destination: '/index.html' }]));
check(() => assert.match(appSource, /allowedRole/));
check(() => assert.match(appSource, /canManageCompanySettings/));
check(() => assert.match(accessSource, /sessionKind === 'owner'.*platformRole === 'owner'/s));
check(() => assert.match(appSource, /destination === 'social_connections'.*view=onboarding#portal/s));
check(() => assert.match(restrictedSource, /SocialConnectionsPanel/));
check(() => assert.match(onboardingSource, /!settingsReadOnly \? <SocialConnectionsPanel/));
check(() => assert.match(config, /\[functions\.meta-social-connection\]\s+verify_jwt = true/));
check(() => assert.match(serverSource, /app_current_session/));
check(() => assert.match(serverSource, /can_manage_company/));
check(() => assert.match(serverSource, /META_GRAPH_API_VERSION/));
check(() => assert.match(serverSource, /META_LOGIN_CONFIGURATION_ID/));
check(() => assert.match(serverSource, /graphApiVersion === PINNED_GRAPH_API_VERSION/));
check(() => assert.doesNotMatch(serverSource, /graphApiVersion\s*\|\|/));
check(() => assert.match(serverSource, /AES-GCM/));
check(() => assert.match(cryptoSource, /additionalData: aad/g));
check(() => assert.match(cryptoSource, /purpose: 'meta-pending'/));
check(() => assert.match(cryptoSource, /purpose: 'meta-connection'/));
check(() => assert.match(serverSource, /validEncryptionKey\(encryptionKey\)/));
check(() => assert.match(serverSource, /SHA-256/));
check(() => assert.match(serverSource, /appsecret_proof/));
check(() => assert.match(serverSource, /Cache-Control.*no-store/s));
check(() => assert.doesNotMatch(serverSource, /console\.(log|error|warn)\([^\n]*(access|state|code|envelope)/i));
check(() => assert.match(migration, /enable row level security/g));
check(() => assert.match(migration, /revoke all on public\.company_social_connections from public, anon, authenticated/));
check(() => assert.match(migration, /revoke all on public\.company_social_oauth_states from public, anon, authenticated/));
check(() => assert.match(migration, /octet_length\(state_hash\) = 32/));
check(() => assert.match(migration, /expires_at <= created_at \+ interval '10 minutes'/));
check(() => assert.match(migration, /consume_company_social_oauth_state/));
check(() => assert.match(migration, /consumed_at is null/));
check(() => assert.match(migration, /grant execute on function public\.consume_company_social_oauth_state[\s\S]*to service_role/));
check(() => assert.doesNotMatch(migration, /grant[^;]+company_social_(connections|oauth_states)[^;]+authenticated/i));
check(() => assert.doesNotMatch(migration, /company_profiles/));
check(() => assert.match(migration, /company_social_connections_active_provider_unique[\s\S]*\(company_id, provider\)[\s\S]*where status <> 'revoked'/));
check(() => assert.match(migration, /replace_company_social_connection/));
check(() => assert.match(migration, /disconnect_company_social_connection/));
check(() => assert.match(migration, /cleanup_company_social_oauth_states/));
check(() => assert.match(migration, /token_envelope_shape_check/));
check(() => assert.match(migration, /pending_envelope_shape_check/));
check(() => assert.equal(normalizeSql(extractSchemaBlock(canonicalSchema)), normalizeSql(extractSchemaBlock(migration))));

check(() => assert.match(providerSource, /config_id: config\.loginConfigurationId/));
check(() => assert.match(providerSource, /override_default_response_type: 'true'/));
check(() => assert.doesNotMatch(providerSource, /scope:/));
check(() => assert.match(providerSource, /MAX_PAGE_REQUESTS = 5/));
check(() => assert.match(providerSource, /MAX_DISCOVERED_PAGES = 100/));
check(() => assert.doesNotMatch(providerSource, /paging\.next/));
check(() => assert.doesNotMatch(providerSource, /method:\s*'DELETE'/));
check(() => assert.doesNotMatch(serviceSource, /provider\.revoke|providerRevokeSucceeded/));
check(() => assert.match(serviceSource, /disconnectConnection/));
check(() => assert.match(serviceSource, /returnDestinationForPath\(consumed\.return_path\)/));
check(() => assert.match(serviceSource, /cleanupOAuthStates/));
check(() => assert.match(serviceSource, /REAUTHORIZATION_CODES/));
check(() => assert.match(serviceSource, /TRANSIENT_PROVIDER_CODES/));
check(() => assert.doesNotMatch(serviceSource, /attempts\s*=\s*1/));
check(() => assert.doesNotMatch(edgeSource, /const \{ data \} = await adminClient/));
check(() => assert.doesNotMatch(edgeSource, /await adminClient\.from\([^\n]+\)\.delete\(\)(?![\s\S]{0,240}if \(error)/));

const distPath = new URL('dist/assets', root);
try {
  await access(distPath);
  const bundleFiles = (await readdir(distPath)).filter((name) => /\.(js|css)$/.test(name));
  const bundleDirectory = fileURLToPath(distPath);
  const bundle = (await Promise.all(bundleFiles.map((name) => readFile(join(bundleDirectory, name), 'utf8')))).join('\n');
  for (const forbidden of [
    /META_APP_SECRET/,
    /META_TOKEN_ENCRYPTION_KEY/,
    /server-only-app-secret/,
    /pages_manage_posts/,
    /instagram_content_publish/,
    /instagram_business_content_publish/,
    /\/media_publish\b/,
  ]) {
    check(() => assert.doesNotMatch(bundle, forbidden));
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

console.log(`Meta connection security scan passed: ${checks}`);

function extractSchemaBlock(source) {
  const match = source.match(/-- META_SOCIAL_CONNECTION_SCHEMA_BEGIN[\s\S]*?-- META_SOCIAL_CONNECTION_SCHEMA_END/);
  assert.ok(match, 'Meta schema parity block is missing');
  return match[0];
}

function normalizeSql(value) {
  return value.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}
