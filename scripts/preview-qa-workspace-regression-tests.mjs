import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertServerGate,
  assertQaCompany,
  assertQaCompanySlot,
  createSyntheticPngBytes,
  createQaWorkspace,
  deleteQaWorkspace,
  disableQaWorkspace,
  enableQaWorkspace,
  handleQaWorkspace,
  projectRefFromSupabaseUrl,
  qaAccessRules,
  qaCompanyId,
  qaCompanyName,
  qaStorageObjects,
  safeQaResult,
} from '../supabase/functions/_shared/preview-qa-workspace/service.js';

function makeBuilder(client, table) {
  const builder = {
    op: '',
    filters: [],
    selected: '',
    options: null,
    rows: null,
    patch: null,
    select(columns, options) {
      this.op = 'select';
      this.selected = columns;
      this.options = options ?? null;
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
      return this;
    },
    maybeSingle() {
      client.calls.push({ type: 'selectSingle', table, selected: this.selected, filters: [...this.filters] });
      return Promise.resolve({ data: client.qaCompany, error: null });
    },
    then(resolve, reject) {
      if (this.op === 'update' || this.op === 'delete') {
        client.calls.push({ type: this.op, table, patch: this.patch, filters: [...this.filters] });
        return Promise.resolve({ error: null }).then(resolve, reject);
      }
      client.calls.push({ type: 'select', table, selected: this.selected, filters: [...this.filters] });
      const count = this.options?.count === 'exact' ? (client.remainingCounts?.[table] ?? 0) : null;
      const data = table === 'company_users' ? client.companyUsers : [];
      return Promise.resolve({ data, count, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

function makeAdminClient({
  existingUser = null,
  qaCompany = { id: qaCompanyId, name: qaCompanyName },
  authUsers = [{
    id: 'auth-user-1',
    email: 'existing-qa@example.test',
    app_metadata: { previewQaWorkspace: true, companyId: qaCompanyId },
  }],
  companyUsers = [{
    company_id: qaCompanyId,
    auth_user_id: 'auth-user-1',
    email: 'existing-qa@example.test',
    role: 'manager',
  }],
  storageObjects = qaStorageObjects().map((object) => ({ bucket: object.bucket, path: object.path })),
  remainingCounts = {},
} = {}) {
  const initialUsers = existingUser ? [existingUser, ...authUsers.filter((user) => user.id !== existingUser.id)] : [...authUsers];
  const client = {
    calls: [],
    qaCompany,
    authUsers: initialUsers,
    companyUsers,
    storageObjects: [...storageObjects],
    remainingCounts,
    auth: {
      admin: {
        listUsers: async () => {
          client.calls.push({ type: 'listUsers' });
          return { data: { users: [...client.authUsers] }, error: null };
        },
        createUser: async (payload) => {
          client.calls.push({ type: 'createUser', payload });
          const user = { id: 'created-auth-user', email: payload.email, app_metadata: payload.app_metadata, user_metadata: payload.user_metadata };
          client.authUsers.push(user);
          return { data: { user }, error: null };
        },
        updateUserById: async (id, payload) => {
          client.calls.push({ type: 'updateUserById', id, payload });
          client.authUsers = client.authUsers.map((user) => user.id === id ? { ...user, ...payload } : user);
          return { data: { user: { id } }, error: null };
        },
        deleteUser: async (id) => {
          client.calls.push({ type: 'deleteUser', id });
          client.authUsers = client.authUsers.filter((user) => user.id !== id);
          return { data: { user: { id } }, error: null };
        },
      },
    },
    storage: {
      from(bucket) {
        return {
          upload: async (storagePath, body, options) => {
            client.calls.push({ type: 'upload', bucket, storagePath, options, size: body.size });
            client.storageObjects = client.storageObjects.filter((object) => !(object.bucket === bucket && object.path === storagePath));
            client.storageObjects.push({ bucket, path: storagePath });
            return { data: { path: storagePath }, error: null };
          },
          remove: async (paths) => {
            client.calls.push({ type: 'removeStorage', bucket, paths });
            client.storageObjects = client.storageObjects.filter((object) => object.bucket !== bucket || !paths.includes(object.path));
            return { data: paths, error: null };
          },
          list: async (folder, options) => {
            client.calls.push({ type: 'listStorage', bucket, folder, options });
            const prefix = `${folder}/`;
            return {
              data: client.storageObjects
                .filter((object) => object.bucket === bucket && object.path.startsWith(prefix))
                .map((object) => ({ name: object.path.slice(prefix.length) }))
                .filter((object) => !options?.search || object.name.includes(options.search)),
              error: null,
            };
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
  return { rpc: async (name) => ({ data: name === 'app_current_session' ? [{ kind: 'owner', role: 'owner', status: 'active' }] : [], error: null }) };
}

function companyCaller() {
  return { rpc: async () => ({ data: [{ kind: 'company', status: 'active' }], error: null }) };
}

function assertNoSecretInResult(result, temporaryPassword) {
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(temporaryPassword), false, 'QA result must not contain the temporary password');
  assert.equal(serialized.includes('SUPABASE_SERVICE_ROLE_KEY'), false, 'QA result must not expose service role secret names');
}

function testServerGates() {
  assert.equal(projectRefFromSupabaseUrl('https://sizdqtgejoikjlgukbqh.supabase.co'), 'sizdqtgejoikjlgukbqh');
  assert.throws(
    () => assertServerGate({ enabled: undefined, supabaseUrl: 'https://sizdqtgejoikjlgukbqh.supabase.co', allowedProjectRef: 'sizdqtgejoikjlgukbqh' }),
    /QA_WORKSPACE_DISABLED/,
  );
  assert.throws(
    () => assertServerGate({ enabled: 'false', supabaseUrl: 'https://sizdqtgejoikjlgukbqh.supabase.co', allowedProjectRef: 'sizdqtgejoikjlgukbqh' }),
    /QA_WORKSPACE_DISABLED/,
  );
  assert.throws(
    () => assertServerGate({ enabled: 'true', supabaseUrl: 'https://wrongref.supabase.co', allowedProjectRef: 'sizdqtgejoikjlgukbqh' }),
    /QA_WORKSPACE_WRONG_PROJECT/,
  );
  assert.throws(
    () => assertServerGate({ enabled: 'true', supabaseUrl: 'https://sizdqtgejoikjlgukbqh.supabase.co', allowedProjectRef: undefined }),
    /QA_WORKSPACE_WRONG_PROJECT/,
  );
  assert.doesNotThrow(
    () => assertServerGate({ enabled: 'true', supabaseUrl: 'https://sizdqtgejoikjlgukbqh.supabase.co', allowedProjectRef: 'sizdqtgejoikjlgukbqh' }),
  );
}

async function testOwnerOnlyCreate() {
  await handleQaWorkspace({ callerClient: ownerCaller(), adminClient: makeAdminClient({ qaCompany: null, authUsers: [] }) }, {
    action: 'create',
    email: 'qa@example.test',
    temporaryPassword: 'temporary-pass-123',
  });
  await assert.rejects(
    () => handleQaWorkspace({ callerClient: companyCaller(), adminClient: makeAdminClient() }, {
      action: 'create',
      email: 'qa@example.test',
      temporaryPassword: 'temporary-pass-123',
    }),
    /OWNER_REQUIRED/,
  );
  await assert.rejects(
    () => handleQaWorkspace({
      callerClient: { rpc: async () => ({ data: [{ kind: 'owner', role: 'admin', status: 'active' }], error: null }) },
      adminClient: makeAdminClient(),
    }, {
      action: 'create',
      email: 'qa@example.test',
      temporaryPassword: 'temporary-pass-123',
    }),
    /OWNER_REQUIRED/,
  );
  await assert.rejects(
    () => handleQaWorkspace({
      callerClient: { rpc: async () => ({ data: [{ kind: 'company', role: 'manager', status: 'active' }], error: null }) },
      adminClient: makeAdminClient(),
    }, {
      action: 'delete',
    }),
    /OWNER_REQUIRED/,
  );
}

async function testCreateAllowedWhenCompanySlotEmpty() {
  const adminClient = makeAdminClient({ qaCompany: null });
  await createQaWorkspace({ adminClient }, { action: 'create', email: 'qa@example.test', temporaryPassword: 'temporary-pass-000' });
  assert.ok(adminClient.calls.some((call) => call.type === 'upsert' && call.table === 'companies'));
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
  assert.equal(createUserCall.payload.app_metadata.previewQaWorkspace, true);
  assert.equal(createUserCall.payload.app_metadata.companyId, qaCompanyId);

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
  const adminClient = makeAdminClient({
    existingUser: { id: 'existing-user', email: 'qa@example.test', app_metadata: { previewQaWorkspace: true, companyId: qaCompanyId } },
  });
  await createQaWorkspace({ adminClient }, { action: 'create', email: 'qa@example.test', temporaryPassword: 'temporary-pass-456' });
  assert.equal(adminClient.calls.filter((call) => call.type === 'createUser').length, 0);
  const updateCalls = adminClient.calls.filter((call) => call.type === 'updateUserById');
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].payload.ban_duration, 'none');
  const companies = adminClient.calls.filter((call) => call.type === 'upsert' && call.table === 'companies');
  assert.equal(companies[0].options.onConflict, 'id');
}

async function testCompanyIdCollisionStopsBeforeAuthOrStorage() {
  const adminClient = makeAdminClient({
    qaCompany: { id: qaCompanyId, name: 'Real Customer Company' },
    existingUser: { id: 'existing-user', email: 'qa@example.test', app_metadata: { previewQaWorkspace: true, companyId: qaCompanyId } },
  });
  await assert.rejects(
    () => createQaWorkspace({ adminClient }, { action: 'create', email: 'qa@example.test', temporaryPassword: 'temporary-pass-111' }),
    /QA_COMPANY_ID_COLLISION/,
  );
  assert.equal(adminClient.calls.filter((call) => call.type === 'listUsers').length, 0);
  assert.equal(adminClient.calls.filter((call) => call.type === 'updateUserById').length, 0);
  assert.equal(adminClient.calls.filter((call) => call.type === 'upload').length, 0);
}

async function testExistingNonQaUserIsRejected() {
  const adminClient = makeAdminClient({
    existingUser: { id: 'real-user', email: 'qa@example.test', app_metadata: {} },
    authUsers: [],
  });
  await assert.rejects(
    () => createQaWorkspace({ adminClient }, { action: 'create', email: 'qa@example.test', temporaryPassword: 'temporary-pass-789' }),
    /QA_USER_EMAIL_ALREADY_EXISTS/,
  );
  assert.equal(adminClient.calls.filter((call) => call.type === 'updateUserById').length, 0);
}

async function testLegacyQaUserRequiresMatchingMembership() {
  const legacyUser = {
    id: 'legacy-user',
    email: 'legacy-qa@example.test',
    app_metadata: {},
    user_metadata: { qa: true, companyId: qaCompanyId },
  };
  const spoofedClient = makeAdminClient({ existingUser: legacyUser, authUsers: [], companyUsers: [] });
  await assert.rejects(
    () => createQaWorkspace(
      { adminClient: spoofedClient },
      { action: 'create', email: legacyUser.email, temporaryPassword: 'temporary-pass-legacy' },
    ),
    /QA_USER_EMAIL_ALREADY_EXISTS/,
  );
  assert.equal(spoofedClient.calls.filter((call) => call.type === 'updateUserById').length, 0);

  const legacyClient = makeAdminClient({
    existingUser: legacyUser,
    authUsers: [],
    companyUsers: [{
      company_id: qaCompanyId,
      auth_user_id: legacyUser.id,
      email: legacyUser.email,
      role: 'manager',
    }],
  });
  await createQaWorkspace(
    { adminClient: legacyClient },
    { action: 'create', email: legacyUser.email, temporaryPassword: 'temporary-pass-legacy' },
  );
  const migrationCall = legacyClient.calls.find((call) => call.type === 'updateUserById');
  assert.equal(migrationCall.id, legacyUser.id);
  assert.equal(migrationCall.payload.app_metadata.previewQaWorkspace, true);
  assert.equal(migrationCall.payload.app_metadata.companyId, qaCompanyId);
}

async function testEnableRequiresQaAppMetadata() {
  const nonQaClient = makeAdminClient({
    existingUser: { id: 'real-user', email: 'qa@example.test', user_metadata: { qa: true, companyId: qaCompanyId }, app_metadata: {} },
    authUsers: [],
  });
  await assert.rejects(
    () => enableQaWorkspace({ adminClient: nonQaClient }, { action: 'enable', email: 'qa@example.test', temporaryPassword: 'temporary-pass-246' }),
    /QA_USER_REQUIRED/,
  );
  assert.equal(nonQaClient.calls.filter((call) => call.type === 'updateUserById').length, 0);

  const qaClient = makeAdminClient({
    existingUser: {
      id: 'existing-user',
      email: 'qa@example.test',
      app_metadata: { previewQaWorkspace: true, companyId: qaCompanyId },
    },
    authUsers: [],
  });
  const result = await enableQaWorkspace(
    { adminClient: qaClient },
    { action: 'enable', email: 'qa@example.test', temporaryPassword: 'temporary-pass-246' },
  );
  assert.equal(result.action, 'enable');
  assert.equal(result.loginReady, true);
  assert.equal(qaClient.calls.find((call) => call.type === 'updateUserById').payload.ban_duration, 'none');
}

async function testDisableTurnsOffAiAssistant() {
  const adminClient = makeAdminClient();
  const result = await disableQaWorkspace({ adminClient });
  assert.equal(result.action, 'disable');
  assert.equal(result.disabledAuthUsers, 1);
  const userUpdate = adminClient.calls.find((call) => call.type === 'update' && call.table === 'company_users');
  assert.equal(userUpdate.patch.status, 'disabled');
  const profileUpdate = adminClient.calls.find((call) => call.type === 'update' && call.table === 'company_profiles');
  assert.equal(profileUpdate.patch.access_rules.aiAssistant, 'off');
  const authBan = adminClient.calls.find((call) => call.type === 'updateUserById');
  assert.equal(authBan.payload.ban_duration, '876000h');
}

async function testDeleteOnlyQaScopedRowsAndStorage() {
  const expectedObjects = qaStorageObjects();
  const adminClient = makeAdminClient({
    storageObjects: [
      ...expectedObjects.map((object) => ({ bucket: object.bucket, path: object.path })),
      { bucket: 'job-files', path: `foreign/${qaCompanyId}/not-owned.png` },
      { bucket: 'other-bucket', path: expectedObjects[0].path },
    ],
  });
  const result = await deleteQaWorkspace({ adminClient });
  const deletes = adminClient.calls.filter((call) => call.type === 'delete');
  assert.ok(deletes.every((call) => call.table === 'companies'
    ? call.filters.some((filter) => filter.column === 'id' && filter.value === qaCompanyId)
    : call.filters.some((filter) => filter.column === 'company_id' && filter.value === qaCompanyId)));
  const storageRemove = adminClient.calls.find((call) => call.type === 'removeStorage');
  assert.equal(storageRemove.bucket, 'job-files');
  assert.deepEqual(storageRemove.paths, expectedObjects.map((object) => object.path));
  assert.equal(adminClient.calls.filter((call) => call.type === 'deleteUser').length, 1);
  assert.equal(result.remainingRows, 0);
  assert.equal(result.remainingStorageObjects, 0);
  assert.equal(result.remainingAuthUsers, 0);
  assert.ok(adminClient.storageObjects.some((object) => object.path.startsWith('foreign/')));
  assert.ok(adminClient.storageObjects.some((object) => object.bucket === 'other-bucket'));
}

async function testDeleteDoesNotRemoveNonQaAuthUser() {
  const adminClient = makeAdminClient({
    authUsers: [{ id: 'auth-user-1', user_metadata: { qa: true, companyId: qaCompanyId }, app_metadata: {} }],
    companyUsers: [],
  });
  await deleteQaWorkspace({ adminClient });
  assert.equal(adminClient.calls.filter((call) => call.type === 'deleteUser').length, 0);
}

async function testCleanupReportsRemainingRows() {
  const adminClient = makeAdminClient({ remainingCounts: { jobs: 2, companies: 1 } });
  await assert.rejects(
    () => deleteQaWorkspace({ adminClient }),
    (error) => error.message === 'QA_CLEANUP_INCOMPLETE'
      && error.safeDetails.remainingRows === 3
      && error.safeDetails.remainingStorageObjects === 0
      && error.safeDetails.remainingAuthUsers === 0,
  );
}

async function testDeleteRemovesTrustedLegacyQaAuthUser() {
  const legacyUser = {
    id: 'legacy-user',
    email: 'legacy-qa@example.test',
    app_metadata: {},
    user_metadata: { qa: true, companyId: qaCompanyId },
  };
  const adminClient = makeAdminClient({
    authUsers: [legacyUser],
    companyUsers: [{
      company_id: qaCompanyId,
      auth_user_id: legacyUser.id,
      email: legacyUser.email,
      role: 'manager',
    }],
  });
  const result = await deleteQaWorkspace({ adminClient });
  assert.equal(adminClient.calls.filter((call) => call.type === 'deleteUser' && call.id === legacyUser.id).length, 1);
  assert.equal(result.remainingAuthUsers, 0);
}

async function testRepeatedCleanupIsSafe() {
  const adminClient = makeAdminClient({ qaCompany: null, authUsers: [], storageObjects: [] });
  const first = await deleteQaWorkspace({ adminClient });
  const second = await deleteQaWorkspace({ adminClient });
  assert.deepEqual(
    [first.remainingRows, first.remainingStorageObjects, first.remainingAuthUsers],
    [0, 0, 0],
  );
  assert.deepEqual(
    [second.remainingRows, second.remainingStorageObjects, second.remainingAuthUsers],
    [0, 0, 0],
  );
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

function testSyntheticImagesAreUsefulPngs() {
  const overview = createSyntheticPngBytes('overview');
  const result = createSyntheticPngBytes('result');
  assert.equal(overview[0], 137);
  assert.equal(overview[1], 80);
  assert.equal(overview[2], 78);
  assert.equal(overview[3], 71);
  assert.ok(overview.length > 750000, 'overview PNG should be a real 512px image, not a 1x1 placeholder');
  assert.ok(result.length > 750000, 'result PNG should be a real 512px image, not a 1x1 placeholder');
  assert.notDeepEqual([...overview.slice(2000, 2050)], [...result.slice(2000, 2050)]);
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

function testPreviewQaUiGateAndPasswordHandling() {
  const root = process.cwd();
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const ownerPages = fs.readFileSync(path.join(root, 'src/components/OwnerPages.tsx'), 'utf8');
  const panel = fs.readFileSync(path.join(root, 'src/components/PreviewQaToolsPanel.tsx'), 'utf8');
  assert.match(app, /import\.meta[\s\S]*\.env\.VITE_PREVIEW_QA_TOOLS_ENABLED === 'true'/);
  assert.match(app, /previewQaToolsBuildEnabled[\s\S]*authSession\?\.kind === 'owner'[\s\S]*currentOwnerRole === 'owner'/);
  assert.match(app, /previewQaToolsBuildEnabled[\s\S]*lazy\(\(\) => import\('\.\/components\/PreviewQaToolsPanel'\)/);
  assert.match(app, /qaTools=\{previewQaToolsVisible && PreviewQaToolsPanel/);
  assert.doesNotMatch(ownerPages, /Preview QA workspace|Create QA workspace|preview-qa-workspace|AI_QA_/);
  assert.match(panel, /finally \{[\s\S]*setTemporaryPassword\(''\)/);
  assert.doesNotMatch(panel, /localStorage|sessionStorage|window\.history/);
  assert.doesNotMatch(panel, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(panel, /temporary-pass-/);
}

function testServerErrorTaxonomy() {
  const edge = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/preview-qa-workspace/index.ts'), 'utf8');
  for (const code of ['QA_WORKSPACE_DISABLED', 'QA_WORKSPACE_WRONG_PROJECT', 'QA_COMPANY_ID_COLLISION']) {
    assert.match(edge, new RegExp(code));
  }
  assert.ok(edge.indexOf('assertServerGate') < edge.indexOf('SUPABASE_SERVICE_ROLE_KEY'), 'server gate must run before service-role key use');
  assert.ok(edge.indexOf('assertServerGate') < edge.indexOf('const adminClient'), 'server gate must run before admin client creation');
}

testServerGates();
await testOwnerOnlyCreate();
await testCreateAllowedWhenCompanySlotEmpty();
await testCreateUsesServerAdminAndIsolatedTenant();
await testDuplicateCreateUpdatesExistingUser();
await testCompanyIdCollisionStopsBeforeAuthOrStorage();
await testExistingNonQaUserIsRejected();
await testLegacyQaUserRequiresMatchingMembership();
await testEnableRequiresQaAppMetadata();
await testDisableTurnsOffAiAssistant();
await testDeleteOnlyQaScopedRowsAndStorage();
await testDeleteDoesNotRemoveNonQaAuthUser();
await testDeleteRemovesTrustedLegacyQaAuthUser();
await testCleanupReportsRemainingRows();
await testRepeatedCleanupIsSafe();
testDeleteGuardRejectsNonQaCompany();
testSafeAccessRules();
testSafeResultHasNoCredentialFields();
testSyntheticImagesAreUsefulPngs();
testConfigAndFrontendSecretBoundary();
testPreviewQaUiGateAndPasswordHandling();
testServerErrorTaxonomy();

console.log('Preview QA workspace regression tests passed');
