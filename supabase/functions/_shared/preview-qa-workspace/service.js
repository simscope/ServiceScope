export const qaPrefix = 'AI_QA_';
export const qaCompanyId = '00000000-0000-4000-8000-000000000074';
export const qaCustomerId = '00000000-0000-4000-8000-000000000174';
export const qaLocationId = '00000000-0000-4000-8000-000000000274';
export const qaCompletedJobId = '00000000-0000-4000-8000-000000000374';
export const qaWarrantyJobId = '00000000-0000-4000-8000-000000000474';
export const qaUnsupportedJobId = '00000000-0000-4000-8000-000000000574';
export const qaPhotoOneId = '00000000-0000-4000-8000-000000000674';
export const qaPhotoTwoId = '00000000-0000-4000-8000-000000000774';
export const jobFilesBucket = 'job-files';

const safePngBytes = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222,
  0, 0, 0, 12, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 0, 0, 3, 1, 1, 0, 24, 221, 141, 181, 0, 0, 0, 0, 73, 69, 78, 68,
  174, 66, 96, 130,
]);

export function parseQaWorkspaceRequest(value) {
  const body = value && typeof value === 'object' ? value : {};
  const action = String(body.action ?? '').trim();
  if (!['create', 'disable', 'delete'].includes(action)) throw new Error('INVALID_QA_ACTION');

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.temporaryPassword ?? '').trim();
  if (action === 'create') {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('QA_EMAIL_REQUIRED');
    if (password.length < 12) throw new Error('QA_TEMPORARY_PASSWORD_REQUIRED');
  }

  return { action, email, temporaryPassword: password };
}

export function assertOwnerSession(sessionRows) {
  const session = Array.isArray(sessionRows) ? sessionRows[0] : null;
  if (!session || session.kind !== 'owner' || session.status !== 'active') throw new Error('OWNER_REQUIRED');
  return session;
}

export function assertQaCompany(company) {
  if (!company || typeof company.name !== 'string' || !company.name.startsWith(qaPrefix)) throw new Error('QA_COMPANY_REQUIRED');
  return company;
}

export function qaAccessRules() {
  return {
    jobInbox: 'off',
    jobs: 'full',
    allJobs: 'full',
    debtors: 'off',
    calendar: 'readonly',
    materials: 'readonly',
    warehouse: 'off',
    tasks: 'off',
    map: 'off',
    email: 'off',
    finances: 'off',
    aiBusiness: 'off',
    aiAssistant: 'full',
    knowledge: 'off',
    import: 'off',
    portal: 'full',
    onboarding: 'off',
  };
}

export function safeQaResult(action, extra = {}) {
  return {
    ok: true,
    action,
    companyId: qaCompanyId,
    companyName: `${qaPrefix}Preview Workspace`,
    ...extra,
  };
}

export async function handleQaWorkspace(deps, requestBody) {
  const request = parseQaWorkspaceRequest(requestBody);
  const { data: sessionRows, error: sessionError } = await deps.callerClient.rpc('app_current_session');
  if (sessionError) throw new Error('OWNER_REQUIRED');
  assertOwnerSession(sessionRows);

  if (request.action === 'create') return createQaWorkspace(deps, request);
  if (request.action === 'disable') return disableQaWorkspace(deps);
  return deleteQaWorkspace(deps);
}

export async function createQaWorkspace(deps, request) {
  const existingUser = await findAuthUserByEmail(deps.adminClient, request.email);
  if (existingUser && !isQaAuthUser(existingUser)) throw new Error('QA_USER_EMAIL_ALREADY_EXISTS');
  const authUser = existingUser ?? (await createAuthUser(deps.adminClient, request));
  if (existingUser) await updateAuthUser(deps.adminClient, existingUser.id, request);

  await upsertRows(deps.adminClient, 'companies', [{
    id: qaCompanyId,
    name: `${qaPrefix}Preview Workspace`,
    owner_name: 'QA Workspace Owner',
    owner_email: 'ai-qa-owner@example.invalid',
    domain: 'qa.preview.local',
    market: 'QA Preview',
    status: 'active',
    billing_status: 'trialing',
    seats_count: 1,
    technicians_count: 0,
    open_jobs_count: 1,
    revenue_cents: 0,
    health_score: 100,
    last_sync_label: 'QA workspace ready',
  }], 'id');

  await upsertRows(deps.adminClient, 'company_profiles', [{
    company_id: qaCompanyId,
    legal_name: `${qaPrefix}Preview Workspace`,
    display_name: `${qaPrefix}Preview`,
    website: 'https://qa.preview.local',
    phone: null,
    billing_email: null,
    service_address: '',
    service_area: 'QA Preview',
    timezone: 'America/New_York',
    emergency_contact: null,
    access_rules: qaAccessRules(),
  }], 'company_id');

  await upsertRows(deps.adminClient, 'company_users', [{
    company_id: qaCompanyId,
    auth_user_id: authUser.id,
    name: 'AI QA User',
    email: request.email,
    role: 'manager',
    status: 'active',
    portal_access_rules: qaAccessRules(),
    updated_at: new Date().toISOString(),
  }], 'company_id,email');

  await upsertQaJobs(deps.adminClient);
  await uploadQaAttachments(deps.adminClient);

  return safeQaResult('create', { email: request.email, loginReady: true });
}

export async function disableQaWorkspace(deps) {
  const company = await loadQaCompany(deps.adminClient);
  assertQaCompany(company);
  await deps.adminClient.from('company_users').update({ status: 'disabled', updated_at: new Date().toISOString() }).eq('company_id', qaCompanyId);
  await deps.adminClient.from('company_profiles').update({ access_rules: { ...qaAccessRules(), aiAssistant: 'off' } }).eq('company_id', qaCompanyId);
  return safeQaResult('disable');
}

export async function deleteQaWorkspace(deps) {
  const company = await loadQaCompany(deps.adminClient);
  assertQaCompany(company);
  const authUserIds = await loadQaAuthUserIds(deps.adminClient);
  await deleteQaStorage(deps.adminClient);
  for (const table of ['job_attachments', 'job_comments', 'job_materials', 'job_invoices', 'job_payments', 'appointments', 'jobs', 'customer_locations', 'customers', 'company_users', 'company_profiles', 'company_onboarding_steps', 'company_job_workflow_settings', 'company_job_types']) {
    await deps.adminClient.from(table).delete().eq('company_id', qaCompanyId);
  }
  await deps.adminClient.from('companies').delete().eq('id', qaCompanyId);
  await deleteQaAuthUsers(deps.adminClient, authUserIds);
  return safeQaResult('delete', { remainingRows: 0 });
}

async function loadQaCompany(adminClient) {
  const { data, error } = await adminClient.from('companies').select('id,name').eq('id', qaCompanyId).maybeSingle();
  if (error) throw error;
  return data;
}

async function findAuthUserByEmail(adminClient, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  return null;
}

function isQaAuthUser(user) {
  return user?.user_metadata?.qa === true && user?.user_metadata?.companyId === qaCompanyId;
}

async function createAuthUser(adminClient, request) {
  const { data, error } = await adminClient.auth.admin.createUser({
    email: request.email,
    password: request.temporaryPassword,
    email_confirm: true,
    user_metadata: { name: 'AI QA User', companyId: qaCompanyId, role: 'manager', qa: true },
  });
  if (error) throw error;
  return data.user;
}

async function updateAuthUser(adminClient, userId, request) {
  const { error } = await adminClient.auth.admin.updateUserById(userId, {
    password: request.temporaryPassword,
    email_confirm: true,
    user_metadata: { name: 'AI QA User', companyId: qaCompanyId, role: 'manager', qa: true },
  });
  if (error) throw error;
}

async function loadQaAuthUserIds(adminClient) {
  const { data, error } = await adminClient
    .from('company_users')
    .select('auth_user_id')
    .eq('company_id', qaCompanyId);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.auth_user_id).filter(Boolean))];
}

async function deleteQaAuthUsers(adminClient, authUserIds) {
  for (const authUserId of authUserIds) {
    const { data, error } = await adminClient.auth.admin.getUserById(authUserId);
    if (error) throw error;
    if (!isQaAuthUser(data?.user)) continue;
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(authUserId);
    if (deleteError) throw deleteError;
  }
}

async function upsertRows(adminClient, table, rows, onConflict) {
  const { error } = await adminClient.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}

async function upsertQaJobs(adminClient) {
  await upsertRows(adminClient, 'customers', [{
    id: qaCustomerId,
    company_id: qaCompanyId,
    organization: `${qaPrefix}Synthetic Customer`,
    primary_name: 'QA Contact',
    primary_email: null,
    primary_phone: '',
    notes: 'Synthetic QA data only.',
  }], 'id');
  await upsertRows(adminClient, 'customer_locations', [{
    id: qaLocationId,
    company_id: qaCompanyId,
    customer_id: qaCustomerId,
    address: '',
  }], 'id');
  await upsertRows(adminClient, 'jobs', [
    qaJob(qaCompletedJobId, 'AI-QA-001', 'Completed', 'Test appliance', 'Synthetic non-private service issue.'),
    qaJob(qaWarrantyJobId, 'AI-QA-002', 'Warranty', 'Test appliance', 'Synthetic warranty follow-up.'),
    qaJob(qaUnsupportedJobId, 'AI-QA-003', 'In progress', 'Test appliance', 'Synthetic unsupported status.'),
  ], 'id');
}

function qaJob(id, jobNumber, status, system, issue) {
  return {
    id,
    company_id: qaCompanyId,
    customer_id: qaCustomerId,
    customer_location_id: qaLocationId,
    technician_id: null,
    job_type_id: null,
    job_number: jobNumber,
    status,
    system,
    issue,
    notes: '',
    service_call_fee_cents: 0,
    labor_cents: 0,
  };
}

async function uploadQaAttachments(adminClient) {
  const attachments = [
    { id: qaPhotoOneId, jobId: qaCompletedJobId, name: `${qaPrefix}photo_overview.png` },
    { id: qaPhotoTwoId, jobId: qaCompletedJobId, name: `${qaPrefix}photo_result.png` },
  ];
  for (const attachment of attachments) {
    const path = `${qaCompanyId}/${attachment.jobId}/${attachment.id}-${attachment.name}`;
    await adminClient.storage.from(jobFilesBucket).upload(path, new Blob([safePngBytes], { type: 'image/png' }), {
      upsert: true,
      contentType: 'image/png',
    });
    await upsertRows(adminClient, 'job_attachments', [{
      id: attachment.id,
      company_id: qaCompanyId,
      job_id: attachment.jobId,
      name: attachment.name,
      mime_type: 'image/png',
      size_bytes: safePngBytes.length,
      kind: 'photo',
      storage_bucket: jobFilesBucket,
      storage_path: path,
    }], 'id');
  }
}

async function deleteQaStorage(adminClient) {
  const { data } = await adminClient.from('job_attachments').select('storage_bucket,storage_path').eq('company_id', qaCompanyId);
  const pathsByBucket = new Map();
  for (const attachment of data ?? []) {
    if (!attachment.storage_bucket || !attachment.storage_path || !attachment.storage_path.includes(qaCompanyId)) continue;
    const paths = pathsByBucket.get(attachment.storage_bucket) ?? [];
    paths.push(attachment.storage_path);
    pathsByBucket.set(attachment.storage_bucket, paths);
  }
  for (const [bucket, paths] of pathsByBucket) {
    if (paths.length) await adminClient.storage.from(bucket).remove(paths);
  }
}
