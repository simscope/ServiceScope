// One ephemeral CI-only stack. Never links, deploys, resets or contacts a remote project.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile, rm, realpath } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { newDraft } from '../src/features/reel-editor/presentation.js';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'CI_ONLY');
assert.equal(process.platform, 'linux', 'LINUX_RUNNER_ONLY');
const temp = await realpath(process.env.RUNNER_TEMP);
const root = resolve(process.env.REEL_AUTH_STACK_ROOT);
const project = process.env.REEL_AUTH_STACK_PROJECT;
assert(/^reel-auth-\d+-\d+$/.test(project), 'INVALID_TEST_PROJECT');
assert(relative(temp, root) && !relative(temp, root).startsWith('..'), 'OUTSIDE_RUNNER_TEMP');
assert.equal(root, join(temp, `servicescope-${project}`));
const scrub = text => String(text).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted JWT]').replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted database URL]').split('\n').filter(line => !/anon.?key|service.?role|secret|password|sb_secret_/i.test(line)).join('\n');
const cli = (args, timeout = 60000) => {
  try { return execFileSync('supabase', args, { cwd: root, encoding: 'utf8', timeout, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (error) { throw new Error(`CLI_FAILED ${args[0]} (${error.code || error.status}): ${scrub(error.stderr || error.stdout || '').slice(-6000)}`); }
};
const dbName = `supabase_db_${project}`;
function sql(source, label) {
  try { execFileSync('docker', ['exec', '-i', dbName, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: source, encoding: 'utf8', timeout: 90000, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (error) { throw new Error(`SQL_REPLAY_FAILED ${label}: ${String(error.stderr || '').trim()}`); }
}
async function cleanup() {
  try { await readFile(join(root, 'owned-project')); } catch { return; }
  assert.equal(await readFile(join(root, 'owned-project'), 'utf8'), project);
  assert.equal(await realpath(root), root, 'UNEXPECTED_SYMLINK');
  cli(['stop', '--no-backup'], 120000);
  const remaining = execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim().split('\n');
  assert(!remaining.some(name => name.endsWith(`_${project}`)), 'TEST_STACK_CONTAINERS_REMAIN');
  const volumes = execFileSync('docker', ['volume', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).trim().split('\n');
  assert(!volumes.some(name => name.endsWith(`_${project}`)), 'TEST_STACK_VOLUMES_REMAIN');
  await rm(root, { recursive: true, force: true });
  console.log('PASS temporary Supabase stopped; own containers, volumes and temporary data removed.');
}
if (process.argv[2] === 'cleanup') { await cleanup(); process.exit(0); }
let server;
try {
  await mkdir(root, { recursive: false });
  await writeFile(join(root, 'owned-project'), project);
  cli(['init']);
  const configPath = join(root, 'supabase', 'config.toml');
  let config = await readFile(configPath, 'utf8');
  config = config.replace(/^project_id\s*=.*$/m, `project_id = "${project}"`);
  await writeFile(configPath, config);
  // Start with no project SQL. Then replay real historical baseline and all migrations once.
  cli(['start', '--exclude', 'studio,postgres-meta,realtime,imgproxy,edge-runtime,logflare,vector,supavisor'], 600000);
  const status = JSON.parse(cli(['status', '-o', 'json']));
  const apiUrl = new URL(status.API_URL);
  const dbUrl = new URL(status.DB_URL);
  assert(['127.0.0.1', 'localhost'].includes(apiUrl.hostname) && apiUrl.protocol === 'http:' && apiUrl.port === '54321', 'NOT_LOCAL_API');
  assert(['127.0.0.1', 'localhost'].includes(dbUrl.hostname) && dbUrl.port === '54322' && dbUrl.pathname === '/postgres', 'NOT_LOCAL_DATABASE');
  const inspected = JSON.parse(execFileSync('docker', ['inspect', dbName], { encoding: 'utf8' }))[0];
  assert.equal(inspected.Name, `/${dbName}`);
  assert(status.ANON_KEY && status.SERVICE_ROLE_KEY, 'LOCAL_KEYS_MISSING');
  for (const secret of [status.ANON_KEY, status.SERVICE_ROLE_KEY, status.JWT_SECRET, status.DB_URL].filter(Boolean)) console.log(`::add-mask::${secret}`);
  console.log(`PASS isolated identity: ${project}; loopback API/PostgreSQL; no linked project or Production credentials.`);
  // This revision immediately precedes the first tracked migration. No SQL is rewritten.
  const baselineSha = '934e06e55e931ff3acefca03a451bde971db2174';
  const baseline = execFileSync('git', ['show', `${baselineSha}:supabase/schema.sql`], { encoding: 'utf8' });
  sql(baseline, `schema.sql@${baselineSha}`);
  console.log(`PASS baseline schema.sql@${baselineSha}`);
  for (const name of (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) {
    if (name === '20260712090000_lock_legacy_import_tables.sql') {
      sql(await readFile('scripts/fixtures/reel-auth-legacy-prerequisite.sql', 'utf8'), 'CI_ONLY_LEGACY_PREREQUISITE');
      console.log('PASS CI-only empty legacy prerequisite; no Auth/RPC substitutions or exposed schema.');
    }
    sql(await readFile(join('supabase/migrations', name), 'utf8'), name);
    console.log(`PASS migration ${name}`);
    if (name === '20260712090000_lock_legacy_import_tables.sql') {
      sql(`do $$ begin
        if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='legacy_import' and c.relname in ('mail_accounts','materials') and c.relrowsecurity) <> 2
          then raise exception 'LEGACY_RLS_NOT_ENABLED'; end if;
        if exists(select 1 from legacy_import.mail_accounts) or exists(select 1 from legacy_import.materials)
          then raise exception 'LEGACY_FIXTURE_NOT_EMPTY'; end if;
      end $$;`, 'LEGACY_RLS_EMPTY_CHECK');
      console.log('PASS legacy RLS enabled on both empty tables.');
      sql(`do $$ begin
        if exists(select 1 from pg_policies where schemaname='legacy_import')
          then raise exception 'LEGACY_PERMISSIVE_POLICY_REMAINS'; end if;
        if exists(select 1 from (values ('anon'),('authenticated')) roles(role_name)
          cross join (values ('legacy_import.mail_accounts'),('legacy_import.materials')) tables(table_name)
          cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) privileges(privilege_name)
          where has_table_privilege(role_name,table_name,privilege_name))
          then raise exception 'LEGACY_BROWSER_CRUD_REMAINS'; end if;
      end $$;`, 'LEGACY_ACL_POLICY_CHECK');
      console.log('PASS legacy anon/authenticated CRUD revoked and permissive policies absent.');
    }
  }
  sql("notify pgrst, 'reload schema';", 'POSTGREST_SCHEMA_RELOAD');
  const key = status.SERVICE_ROLE_KEY, anon = status.ANON_KEY;
  const endpoint = apiUrl.origin;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    assert(['127.0.0.1', 'localhost'].includes(target.hostname) && target.protocol === 'http:', 'NONLOCAL_HTTP_FORBIDDEN');
    return nativeFetch(input, options);
  };
  async function local(path, { token = key, method = 'GET', body, raw, headers = {} } = {}) {
    assert(path.startsWith('/') && !path.startsWith('//'));
    const response = await fetch(`${endpoint}${path}`, { method, headers: { apikey: token === key ? key : anon, Authorization: `Bearer ${token}`, ...(!raw && body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: raw || (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    assert(response.ok, `LOCAL_SETUP_HTTP_${response.status} ${path}: ${data?.code || data?.error_code || 'response unavailable'}`);
    return data;
  }
  const password = `CiOnly-${randomUUID()}!`;
  console.log(`::add-mask::${password}`);
  async function user(label) {
    const email = `${label}@example.invalid`;
    const created = await local('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } });
    const session = await local('/auth/v1/token?grant_type=password', { method: 'POST', token: anon, body: { email, password } });
    assert(session.access_token && created.id);
    console.log(`::add-mask::${session.access_token}`);
    return { id: created.id, email, token: session.access_token };
  }
  const manager = await user('editor-manager'), readonly = await user('editor-readonly'), other = await user('editor-other');
  const company = randomUUID(), foreignCompany = randomUUID(), job = randomUUID();
  const q = value => `'${String(value).replaceAll("'", "''")}'`;
  sql(`insert into public.companies(id,name,owner_email) values(${q(company)},'Synthetic editor company','synthetic-owner@example.invalid'),(${q(foreignCompany)},'Synthetic other company',${q(other.email)});
    insert into public.company_profiles(company_id,display_name,ai_public_display_name) values(${q(company)},'Synthetic workshop','Synthetic workshop');
    insert into public.company_users(company_id,auth_user_id,name,email,role,status,portal_access_rules) values
    (${q(company)},${q(manager.id)},'Synthetic manager',${q(manager.email)},'manager','active','{"aiAssistant":"full"}'),
    (${q(company)},${q(readonly.id)},'Synthetic readonly',${q(readonly.email)},'manager','active','{"aiAssistant":"read"}');
    insert into public.jobs(id,company_id,job_number,status) values(${q(job)},${q(company)},'SYNTHETIC-AUTH-ONLY','Completed');`, 'SYNTHETIC_SETUP');
  await local('/storage/v1/bucket', { method: 'POST', body: { id: 'reel-auth-fixtures', name: 'reel-auth-fixtures', public: false } });
  const media = [];
  for (let i = 0; i < 3; i++) {
    const bytes = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: ['#143d53', '#245647', '#573454'][i] } }).png().toBuffer();
    const id = randomUUID(), analysis = randomUUID(), path = `synthetic-${i}.png`, sha = createHash('sha256').update(bytes).digest('hex');
    await local(`/storage/v1/object/reel-auth-fixtures/${path}`, { method: 'POST', raw: bytes, headers: { 'Content-Type': 'image/png' } });
    sql(`insert into public.job_attachments(id,company_id,job_id,name,mime_type,size_bytes,kind,storage_bucket,storage_path) values(${q(id)},${q(company)},${q(job)},'Synthetic grid','image/png',${bytes.length},'photo','reel-auth-fixtures',${q(path)});
      insert into public.company_media_analysis_runs(id,company_id,job_id,correlation_id,status,provider,analysis_version) values(${q(analysis)},${q(company)},${q(job)},'synthetic-auth-fixture','completed','synthetic-fixture','synthetic-v1');
      insert into public.company_media_analysis_attachment_results(id,analysis_run_id,company_id,job_id,attachment_id,attachment_sha256,detected_mime_type,analysis_status,privacy_review_status) values(${q(analysis)},${q(analysis)},${q(company)},${q(job)},${q(id)},decode(${q(sha)},'hex'),'image/png','analyzed','passed');`, 'SYNTHETIC_MEDIA');
    media.push({ attachmentId: id });
  }
  process.env.SUPABASE_URL = endpoint;
  process.env.SUPABASE_ANON_KEY = anon;
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  process.env.REEL_RENDER_ENABLED = 'false';
  const { default: handler } = await import('../api/reel-editor.js');
  server = createServer((req, res) => { if (req.url !== '/api/reel-editor') { res.writeHead(404).end(); return; } handler(req, res).catch(() => { res.writeHead(500).end(); }); });
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const app = `http://127.0.0.1:${server.address().port}/api/reel-editor`;
  if (process.env.REEL_BROWSER_FLOW === '1') {
    // A separate synthetic Job; UI actions must not reuse an HTTP-smoke approval.
    const browserJob = randomUUID();
    sql(`update public.companies set status='active' where id=${q(company)};
      insert into public.jobs(id,company_id,job_number,status) values(${q(browserJob)},${q(company)},'SYNTHETIC-BROWSER','Completed');
      insert into public.job_attachments(id,company_id,job_id,name,mime_type,size_bytes,kind,storage_bucket,storage_path)
        select gen_random_uuid(),company_id,${q(browserJob)},name,mime_type,size_bytes,kind,storage_bucket,storage_path from public.job_attachments where job_id=${q(job)};
      insert into public.company_media_analysis_runs(id,company_id,job_id,correlation_id,status,provider,analysis_version)
        values(${q(browserJob)},${q(company)},${q(browserJob)},'synthetic-browser-fixture','completed','synthetic-fixture','synthetic-v1');
      insert into public.company_media_analysis_attachment_results(id,analysis_run_id,company_id,job_id,attachment_id,attachment_sha256,detected_mime_type,analysis_status,privacy_review_status)
        select gen_random_uuid(),${q(browserJob)},a.company_id,a.job_id,a.id,r.attachment_sha256,r.detected_mime_type,r.analysis_status,r.privacy_review_status
        from public.job_attachments a join public.job_attachments original on original.job_id=${q(job)} and original.storage_path=a.storage_path
        join public.company_media_analysis_attachment_results r on r.attachment_id=original.id where a.job_id=${q(browserJob)};`, 'SYNTHETIC_BROWSER_JOB');
    const { browserEditorFlow } = await import('./reel-editor-browser-flow.mjs');
    await browserEditorFlow({ endpoint, anon, email: manager.email, password, managerId: manager.id, apiOrigin: new URL(app).origin });
  } else {
  async function call(operation, extra = {}, token = manager.token) {
    const response = await fetch(app, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ operation, jobId: job, ...extra }), signal: AbortSignal.timeout(15000) });
    return { status: response.status, body: await response.json() };
  }
  const draft = newDraft(job, media.reverse());
  draft.brief.problem = 'Synthetic loose fitting found.';
  draft.brief.work = 'Synthetic fitting secured.';
  draft.scenes.forEach(scene => { scene.text.headline = draft.brief.work; scene.text.factRefs = ['work']; });
  draft.scenes[0].frames = 90; draft.scenes[0].text.disappear = 90; draft.scenes[0].crop.x = .62;
  const saved = await call('save', { draft, expectedRevision: 0, confirmBrief: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.row.brief_confirmation.actorId, manager.id);
  const loaded = await call('load'); assert.equal(loaded.status, 200); assert.deepEqual(loaded.body.row.draft, draft); assert.equal(loaded.body.row.revision, 1);
  console.log('PASS HTTP/JWT/PostgREST save/load: draft, media order, None/crop/timing, revision and server confirmation restored (separate HTTP request; no browser reload).');
  const approved = await call('approve', { expectedRevision: 1 }); assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const caption = await call('save', { draft: { ...draft, caption: 'Synthetic service details.' }, expectedRevision: 1, confirmBrief: false }); assert.equal(caption.status, 200);
  assert.equal(caption.body.row.approval.creativePlanId, approved.body.row.approval.creativePlanId);
  assert.equal(caption.body.row.approval.revision, approved.body.row.approval.revision);
  assert.equal(caption.body.row.approval.draftRevision, 2);
  console.log('PASS exact snapshot approval and caption-only save preserve video approval.');
  const stale = await call('save', { draft, expectedRevision: 1 }); assert.equal(stale.body.code, 'EDITOR_DRAFT_CONFLICT'); assert.equal(stale.status, 409);
  const latest = await call('load'); assert.equal(latest.body.row.revision, 2); assert.equal(latest.body.row.draft.caption, 'Synthetic service details.'); assert.equal(latest.body.row.approvalApplicable, true);
  console.log('PASS stale revision rejected; latest draft and approval preserved.');
  const noAuth = await call('load', {}, ''); assert.equal(noAuth.body.code, 'AUTH_REQUIRED'); assert(noAuth.status >= 400);
  const readDenied = await call('save', { draft, expectedRevision: 2 }, readonly.token); assert.equal(readDenied.body.code, 'FORBIDDEN'); assert(readDenied.status >= 400);
  for (const operation of ['load', 'save']) { const denied = await call(operation, { draft, expectedRevision: 2 }, other.token); assert.equal(denied.body.code, 'FORBIDDEN'); assert(denied.status >= 400); }
  console.log('PASS no JWT, readonly mutation, foreign-company read/mutation denied.');
  sql("do $$ begin if exists(select 1 from public.company_reel_render_jobs) then raise exception 'UNEXPECTED_RENDER_JOB'; end if; end $$;", 'NO_RENDER_JOB');
  console.log('PASS HTTP/JWT/PostgREST flow checked; no render job, Queue, AI or provider calls. Not Vercel UI E2E.');
  }
  sql("do $$ begin if exists(select 1 from public.company_reel_render_jobs) then raise exception 'UNEXPECTED_RENDER_JOB'; end if; end $$;", 'NO_BROWSER_RENDER_JOB');
} catch (error) {
  // No CLI start/status output is logged: it can contain local credentials.
  console.error(error.message?.startsWith('SQL_REPLAY_FAILED') ? error.message : `AUTH_STACK_FAILED ${error.code || error.name}: ${error.message?.startsWith('Command failed') ? 'CLI command failed; credential-bearing output withheld' : error.message}`);
  process.exitCode = 1;
} finally {
  if (server) await new Promise(resolveClosed => server.close(resolveClosed));
  try { await cleanup(); } catch (error) { console.error(`CLEANUP_FAILED ${error.code || error.name}`); process.exitCode = 1; }
}
