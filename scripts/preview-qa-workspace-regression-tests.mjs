import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertQaCompany,
  createQaWorkspace,
  deleteQaWorkspace,
  disableQaWorkspace,
  handleQaWorkspace,
  qaAccessRules,
  qaCompanyId,
  qaPrefix,
  safeQaResult,
} from '../supabase/functions/_shared/preview-qa-workspace/service.js';

function makeBuilder(client, table) {
  const builder = {
    op: '',
    filters: [],
    selected: '',
    rows: null,
    patch: null,
    select(columns) {
      this.op = 'select';
      this.selected = columns;
      return this;
    },
    upsert(rows, options) {
      client.calls.push({ type: 'upsert', table, rows, options });
      return Promise.resolve({ error: null });
    },
    update(patch) {
      this.op = 'update';
      this.patch = patch;
      return this;
    },
    delete() {
      this.op = 'delete';
      return this;
    },
    eq(column, value) {
      this.filters.push({ column, value });
      if (this.op === 'update' || this.op === 'delete') {
        client.calls.push({ type: this.op, table, patch: this.patch, filters: [...this.filters] });
        return Promise.resolve({ error: null });
      }
      return this;
    },
    maybeSingle() {
      client.calls.push({ type: 'selectSingle', table, selected: this.selected, filters: [...this.filters] });
      return Promise.resolve({ data: client.qaCompany, error: null });
    },
    then(resolve, reject) {
      client.calls.push({ type: 'select', table, selected: this.selected, filters: [...this.filters] });
      const data = table === 'job_attachments'
        ? [{ storage_bucket: 'job-files', storage_path: `${qaCompanyId}/job/file.png` }]
        : table === 'company_users'
          ? [{ auth_user_id: 'auth-user-1' }]
          : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

function makeAdminClient({ existingUser = null, qaCompany = { id: qaCompanyId, name: `${qaPrefix}Preview Workspace` } } = {}) {
  const client = {
    calls: [],
    qaCompany,
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: existingUser ? [existingUser] : [] }, error: null }),
        createUser: async (payload) => {
          client.calls.push({ type: 'createUser', payload });
          return { data: { user: { id: 'auth-user-1', email: payload.email } }, error: null };
        },
        updateUserById: async (id, payload) => {
          client.calls.push({ type: 'updateUserById', id, payload });
          return { data: { user: { id } }, error: null };
        },
        getUserById: async (id) => {
          client.calls.push({ type: 'getUserById', id });
          return { data: { user: { id, user_metadata: { qa: true, companyId: qaCompanyId } } }, error: null };
        },
        deleteUser: async (id) => {
          client.calls.push({ type: 'deleteUser', id });
          return { data: { user: { id } }, error: null };
        },
      },
    },
    storage: {
      from(bucket) {
        return {
          upload: async (storagePath, body, options) => {
            client.calls.push({ type: 'upload', bucket, storagePath, options, size: body.size });
            return { data: { path: storagePath }, error: null };
          },
          remove: async (paths) => {
            client.calls.push({ type: 'removeStorage', bucket, paths });
            return { data: paths, error: null };
          },
        };
      },
    },
    from(table) {
      return makeBuilder(client, table);
    },
  };
  return client;
}

function ownerCaller() {
  return { rpc: async (name) => ({ data: name === 'app_current_session' ? [{ kind: 'owner', status: 'active' }] : [], error: null }) };
}

function companyCaller() {
  return { rpc: async () => ({ data: [{ kind: 'company', status: 'active' }], error: null }) };
}

function assertNoSecretInResult(result, temporaryPassword) {
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(temporaryPassword), false, 'QA result must not contain the temporary password');
  assert.equal(serialized.includes('SUPABASE_SERVICE_ROLE_KEY'), false, 'QA result must not expose service role secret names');
}

async function testOwnerOnlyCreate() {
  await assert.rejects(
    () => handleQaWorkspace({ callerClient: companyCaller(), adminClient: makeAdminClient() }, {
      action: 'create',
      email: 'qa@example.test',
      temporaryPassword: 'temporary-pass-123',
    }),
    /OWNER_REQUIRED/,
  );
}

async function testCreateUsesServerAdminAndIsolatedTenant() {
  const password = 'temporary-pass-123';
  const adminClient = makeAdminClient();
  const result = await createQaWorkspace({ adminClient }, { action: 'create', email: 'qa@example.test', temporaryPassword: password });
  assert.equal(result.loginReady, true);
  assertNoSecretInResult(result, password);

  const createUserCall = adminClient.calls.find((call) => call.type === 'createUser');
  assert.ok(createUserCall, 'server admin user creation should be used');
  assert.equal(createUserCall.payload.email, 'qa@example.test');
  assert.equal(createUserCall.payload.password, password);

  const companyUserUpsert = adminClient.calls.find((call) => call.type === 'upsert' && call.table === 'company_users');
  assert.equal(companyUserUpsert.rows[0].company_id, qaCompanyId);
  assert.equal(companyUserUpsert.rows[0].role, 'manager');
  assert.equal(companyUserUpsert.rows[0].status, 'active');
  assert.equal(companyUserUpsert.rows[0].portal_access_rules.aiAssistant, 'full');
  assert.equal(companyUserUpsert.rows[0].portal_access_rules.finances, 'off');

  const foreignCompanyIds = adminClient.calls
    .filter((call) => call.rows)
    .flatMap((call) => call.rows)
    .map((row) => row.company_id)
    .filter(Boolean)
    .filter((companyId) => companyId !== qaCompanyId);
  assert.deepEqual(foreignCompanyIds, []);
}

async function testDuplicateCreateUpdatesExistingUser() {
  const adminClient = makeAdminClient({ existingUser: { id: 'existing-user', email: 'qa@example.test', user_metadata: { qa: true, companyId: qaCompanyId } } });
  await createQaWorkspace({ adminClient }, { action: 'create', email: 'qa@example.test', temporaryPassword: 'temporary-pass-456' });
  assert.equal(adminClient.calls.filter((call) => call.type === 'createUser').length, 0);
  assert.equal(adminClient.calls.filter((call) => call.type === 'updateUserById').length, 1);
  const companies = adminClient.calls.filter((call) => call.type === 'upsert' && call.table === 'companies');
  assert.equal(companies[0].options.onConflict, 'id');
}

async function testExistingNonQaUserIsRejected() {
  const adminClient = makeAdminClient({ existingUser: { id: 'real-user', email: 'qa@example.test', user_metadata: { qa: false } } });
  await assert.rejects(
    () => createQaWorkspace({ adminClient }, { action: 'create', email: 'qa@example.test', temporaryPassword: 'temporary-pass-789' }),
    /QA_USER_EMAIL_ALREADY_EXISTS/,
  );
  assert.equal(adminClient.calls.filter((call) => call.type === 'updateUserById').length, 0);
}

async function testDisableTurnsOffAiAssistant() {
  const adminClient = makeAdminClient();
  const result = await disableQaWorkspace({ adminClient });
  assert.equal(result.action, 'disable');
  const userUpdate = adminClient.calls.find((call) => call.type === 'update' && call.table === 'company_users');
  assert.equal(userUpdate.patch.status, 'disabled');
  const profileUpdate = adminClient.calls.find((call) => call.type === 'update' && call.table === 'company_profiles');
  assert.equal(profileUpdate.patch.access_rules.aiAssistant, 'off');
}

async function testDeleteOnlyQaScopedRowsAndStorage() {
  const adminClient = makeAdminClient();
  await deleteQaWorkspace({ adminClient });
  const deletes = adminClient.calls.filter((call) => call.type === 'delete');
  assert.ok(deletes.every((call) => call.table === 'companies'
    ? call.filters.some((filter) => filter.column === 'id' && filter.value === qaCompanyId)
    : call.filters.some((filter) => filter.column === 'company_id' && filter.value === qaCompanyId)));
  assert.ok(adminClient.calls.some((call) => call.type === 'removeStorage' && call.paths.every((storagePath) => storagePath.includes(qaCompanyId))));
  assert.equal(adminClient.calls.filter((call) => call.type === 'deleteUser').length, 1);
}

function testDeleteGuardRejectsNonQaCompany() {
  assert.throws(() => assertQaCompany({ id: 'real-company', name: 'Real Customer Company' }), /QA_COMPANY_REQUIRED/);
}

function testSafeAccessRules() {
  const rules = qaAccessRules();
  assert.equal(rules.aiAssistant, 'full');
  assert.equal(rules.jobs, 'full');
  assert.equal(rules.allJobs, 'full');
  assert.equal(rules.finances, 'off');
  assert.equal(rules.aiBusiness, 'off');
}

function testSafeResultHasNoCredentialFields() {
  const result = safeQaResult('create', { email: 'qa@example.test', loginReady: true });
  assert.equal(Object.hasOwn(result, 'temporaryPassword'), false);
  assert.equal(Object.hasOwn(result, 'password'), false);
  assert.equal(Object.hasOwn(result, 'jwt'), false);
}

function testConfigAndFrontendSecretBoundary() {
  const root = process.cwd();
  const config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  assert.match(config, /\[functions\.preview-qa-workspace\][\s\S]*verify_jwt\s*=\s*true/);

  const frontendService = fs.readFileSync(path.join(root, 'src/services/previewQaWorkspace.ts'), 'utf8');
  assert.equal(frontendService.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(frontendService.includes('auth.admin'), false);
  assert.equal(frontendService.includes('localStorage'), false);
  assert.equal(frontendService.includes('OPENAI_API_KEY'), false);
}

await testOwnerOnlyCreate();
await testCreateUsesServerAdminAndIsolatedTenant();
await testDuplicateCreateUpdatesExistingUser();
await testExistingNonQaUserIsRejected();
await testDisableTurnsOffAiAssistant();
await testDeleteOnlyQaScopedRowsAndStorage();
testDeleteGuardRejectsNonQaCompany();
testSafeAccessRules();
testSafeResultHasNoCredentialFields();
testConfigAndFrontendSecretBoundary();

console.log('Preview QA workspace regression tests passed');
