export const qaPrefix = 'AI_QA_';
export const qaCompanyName = `${qaPrefix}Preview Workspace`;
export const qaCompanyId = '00000000-0000-4000-8000-000000000074';
export const qaCustomerId = '00000000-0000-4000-8000-000000000174';
export const qaLocationId = '00000000-0000-4000-8000-000000000274';
export const qaCompletedJobId = '00000000-0000-4000-8000-000000000374';
export const qaWarrantyJobId = '00000000-0000-4000-8000-000000000474';
export const qaUnsupportedJobId = '00000000-0000-4000-8000-000000000574';
export const qaPhotoOneId = '00000000-0000-4000-8000-000000000674';
export const qaPhotoTwoId = '00000000-0000-4000-8000-000000000774';
export const jobFilesBucket = 'job-files';

const imageSize = 512;

export function projectRefFromSupabaseUrl(supabaseUrl) {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0] ?? '';
  } catch {
    return '';
  }
}

export function assertServerGate({ enabled, supabaseUrl, allowedProjectRef }) {
  if (enabled !== 'true') throw new Error('QA_WORKSPACE_DISABLED');
  const expectedRef = String(allowedProjectRef ?? '').trim();
  if (!expectedRef || projectRefFromSupabaseUrl(supabaseUrl) !== expectedRef) {
    throw new Error('QA_WORKSPACE_WRONG_PROJECT');
  }
}

export function parseQaWorkspaceRequest(value) {
  const body = value && typeof value === 'object' ? value : {};
  const action = String(body.action ?? '').trim();
  if (!['create', 'disable', 'enable', 'delete'].includes(action)) throw new Error('INVALID_QA_ACTION');

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.temporaryPassword ?? '').trim();
  if (action === 'create' || action === 'enable') {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('QA_EMAIL_REQUIRED');
    if (password.length < 12) throw new Error('QA_TEMPORARY_PASSWORD_REQUIRED');
  }

  return { action, email, temporaryPassword: password };
}

export function assertOwnerSession(sessionRows) {
  const session = Array.isArray(sessionRows) ? sessionRows[0] : null;
  if (!session || session.kind !== 'owner' || session.role !== 'owner' || session.status !== 'active') throw new Error('OWNER_REQUIRED');
  return session;
}

export function assertQaCompany(company) {
  if (!company || company.id !== qaCompanyId || company.name !== qaCompanyName) throw new Error('QA_COMPANY_REQUIRED');
  return company;
}

export function assertQaCompanySlot(company) {
  if (!company) return null;
  if (company.id === qaCompanyId && company.name === qaCompanyName) return company;
  throw new Error('QA_COMPANY_ID_COLLISION');
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
    companyName: qaCompanyName,
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
  if (request.action === 'enable') return enableQaWorkspace(deps, request);
  return deleteQaWorkspace(deps);
}

export async function createQaWorkspace(deps, request) {
  const company = await loadQaCompany(deps.adminClient);
  assertQaCompanySlot(company);

  const existingUser = await findAuthUserByEmail(deps.adminClient, request.email);
  if (existingUser
    && !isQaAuthUser(existingUser)
    && !await isTrustedLegacyQaAuthUser(deps.adminClient, existingUser, request.email)) {
    throw new Error('QA_USER_EMAIL_ALREADY_EXISTS');
  }
  const authUser = existingUser ?? (await createAuthUser(deps.adminClient, request));
  if (existingUser) await updateAuthUser(deps.adminClient, existingUser, request);

  await upsertRows(deps.adminClient, 'companies', [{
    id: qaCompanyId,
    name: qaCompanyName,
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
    legal_name: qaCompanyName,
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

  await upsertRows(deps.adminClient, 'company_users', [qaCompanyUser(authUser.id, request.email)], 'company_id,email');

  await upsertQaJobs(deps.adminClient);
  await uploadQaAttachments(deps.adminClient);

  return safeQaResult('create', { email: request.email, loginReady: true });
}

export async function disableQaWorkspace(deps) {
  const company = await loadQaCompany(deps.adminClient);
  assertQaCompany(company);
  const qaAuthUsers = await findTrustedQaAuthUsers(deps.adminClient);
  await updateQaMemberships(deps.adminClient, qaAuthUsers, 'disabled');
  await updateRows(deps.adminClient, 'company_profiles', { access_rules: { ...qaAccessRules(), aiAssistant: 'off' } }, [['company_id', qaCompanyId]]);
  const disabledAuthUsers = await disableQaAuthUsers(deps.adminClient, qaAuthUsers);
  return safeQaResult('disable', { disabledAuthUsers });
}

export async function enableQaWorkspace(deps, request) {
  const company = await loadQaCompany(deps.adminClient);
  assertQaCompany(company);
  const authUser = await findAuthUserByEmail(deps.adminClient, request.email);
  if (!isQaAuthUser(authUser)
    && !await isTrustedLegacyQaAuthUser(deps.adminClient, authUser, request.email)) {
    throw new Error('QA_USER_REQUIRED');
  }
  await updateAuthUser(deps.adminClient, authUser, request);
  await upsertRows(deps.adminClient, 'company_users', [qaCompanyUser(authUser.id, request.email)], 'company_id,email');
  await updateRows(deps.adminClient, 'company_profiles', { access_rules: qaAccessRules() }, [['company_id', qaCompanyId]]);
  return safeQaResult('enable', { email: request.email, loginReady: true });
}

export async function deleteQaWorkspace(deps) {
  const company = await loadQaCompany(deps.adminClient);
  assertQaCompanySlot(company);
  const qaAuthUsers = await findTrustedQaAuthUsers(deps.adminClient);
  await deleteQaStorage(deps.adminClient);
  await deleteQaAuthUsers(deps.adminClient, qaAuthUsers);
  for (const table of ['job_attachments', 'job_comments', 'job_materials', 'job_invoices', 'job_payments', 'appointments', 'jobs', 'customer_locations', 'customers', 'company_users', 'company_profiles', 'company_onboarding_steps', 'company_job_workflow_settings', 'company_job_types']) {
    await deleteRows(deps.adminClient, table, [['company_id', qaCompanyId]]);
  }
  await deleteRows(deps.adminClient, 'companies', [['id', qaCompanyId]]);
  const remainingRows = await countRemainingQaRows(deps.adminClient);
  const remainingStorageObjects = await countRemainingQaStorageObjects(deps.adminClient);
  const remainingAuthUsers = (await findTrustedQaAuthUsers(deps.adminClient)).length;
  if (remainingRows || remainingStorageObjects || remainingAuthUsers) {
    const error = new Error('QA_CLEANUP_INCOMPLETE');
    error.safeDetails = { remainingRows, remainingStorageObjects, remainingAuthUsers };
    throw error;
  }
  return safeQaResult('delete', { remainingRows, remainingStorageObjects, remainingAuthUsers });
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
  return user?.app_metadata?.previewQaWorkspace === true && user?.app_metadata?.companyId === qaCompanyId;
}

function isLegacyQaAuthUser(user) {
  return user?.user_metadata?.qa === true && user?.user_metadata?.companyId === qaCompanyId;
}

async function createAuthUser(adminClient, request) {
  const { data, error } = await adminClient.auth.admin.createUser({
    email: request.email,
    password: request.temporaryPassword,
    email_confirm: true,
    app_metadata: { previewQaWorkspace: true, companyId: qaCompanyId },
    user_metadata: { name: 'AI QA User', companyId: qaCompanyId, role: 'manager', qa: true },
  });
  if (error) throw error;
  return data.user;
}

async function updateAuthUser(adminClient, user, request) {
  const { error } = await adminClient.auth.admin.updateUserById(user.id, {
    password: request.temporaryPassword,
    email_confirm: true,
    ban_duration: 'none',
    app_metadata: { ...(user.app_metadata ?? {}), previewQaWorkspace: true, companyId: qaCompanyId },
    user_metadata: { name: 'AI QA User', companyId: qaCompanyId, role: 'manager', qa: true },
  });
  if (error) throw error;
}

function qaCompanyUser(authUserId, email) {
  return {
    company_id: qaCompanyId,
    auth_user_id: authUserId,
    name: 'AI QA User',
    email,
    role: 'manager',
    status: 'active',
    portal_access_rules: qaAccessRules(),
    updated_at: new Date().toISOString(),
  };
}

async function findTrustedQaAuthUsers(adminClient) {
  const memberships = await loadQaMemberships(adminClient);
  const users = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users.filter((user) => isQaAuthUser(user) || hasTrustedLegacyQaMembership(user, memberships)));
    if (data.users.length < 1000) break;
  }
  return users;
}

async function isTrustedLegacyQaAuthUser(adminClient, user, email) {
  if (!user || user.email?.toLowerCase() !== email || !isLegacyQaAuthUser(user)) return false;
  return hasTrustedLegacyQaMembership(user, await loadQaMemberships(adminClient));
}

async function loadQaMemberships(adminClient) {
  const { data, error } = await adminClient
    .from('company_users')
    .select('company_id,auth_user_id,email,role')
    .eq('company_id', qaCompanyId);
  if (error) throw error;
  return data ?? [];
}

function hasTrustedLegacyQaMembership(user, memberships) {
  if (!isLegacyQaAuthUser(user)) return false;
  return memberships.some((membership) => membership.company_id === qaCompanyId
    && membership.auth_user_id === user.id
    && membership.email?.toLowerCase() === user.email?.toLowerCase()
    && membership.role === 'manager');
}

async function deleteQaAuthUsers(adminClient, authUsers) {
  for (const authUser of authUsers) {
    if (!isQaAuthUser(authUser) && !isLegacyQaAuthUser(authUser)) continue;
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(authUser.id);
    if (deleteError) throw deleteError;
  }
}

async function disableQaAuthUsers(adminClient, authUsers) {
  let disabled = 0;
  for (const authUser of authUsers) {
    if (!isQaAuthUser(authUser) && !isLegacyQaAuthUser(authUser)) continue;
    const { error: updateError } = await adminClient.auth.admin.updateUserById(authUser.id, { ban_duration: '876000h' });
    if (updateError) throw updateError;
    disabled += 1;
  }
  return disabled;
}

async function updateQaMemberships(adminClient, authUsers, status) {
  for (const authUser of authUsers) {
    if (!isQaAuthUser(authUser) && !isLegacyQaAuthUser(authUser)) continue;
    await updateRows(
      adminClient,
      'company_users',
      { status, updated_at: new Date().toISOString() },
      [['company_id', qaCompanyId], ['auth_user_id', authUser.id]],
    );
  }
}

async function upsertRows(adminClient, table, rows, onConflict) {
  const { error } = await adminClient.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}

async function updateRows(adminClient, table, patch, filters) {
  let query = adminClient.from(table).update(patch);
  for (const [column, value] of filters) query = query.eq(column, value);
  const { error } = await query;
  if (error) throw error;
}

async function deleteRows(adminClient, table, filters) {
  let query = adminClient.from(table).delete();
  for (const [column, value] of filters) query = query.eq(column, value);
  const { error } = await query;
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
  const attachments = qaStorageObjects();
  for (const attachment of attachments) {
    const safePngBytes = createSyntheticPngBytes(attachment.scene);
    const { error: uploadError } = await adminClient.storage.from(attachment.bucket).upload(attachment.path, new Blob([safePngBytes], { type: 'image/png' }), {
      upsert: true,
      contentType: 'image/png',
    });
    if (uploadError) throw uploadError;
    await upsertRows(adminClient, 'job_attachments', [{
      id: attachment.id,
      company_id: qaCompanyId,
      job_id: attachment.jobId,
      name: attachment.name,
      mime_type: 'image/png',
      size_bytes: safePngBytes.length,
      kind: 'photo',
      storage_bucket: attachment.bucket,
      storage_path: attachment.path,
    }], 'id');
  }
}

export function qaStorageObjects() {
  return [
    qaStorageObject(qaPhotoOneId, `${qaPrefix}photo_overview.png`, 'overview'),
    qaStorageObject(qaPhotoTwoId, `${qaPrefix}photo_result.png`, 'result'),
  ];
}

function qaStorageObject(id, name, scene) {
  return {
    id,
    jobId: qaCompletedJobId,
    name,
    scene,
    bucket: jobFilesBucket,
    path: `${qaCompanyId}/${qaCompletedJobId}/${id}-${name}`,
  };
}

async function deleteQaStorage(adminClient) {
  const paths = qaStorageObjects().map((object) => object.path);
  const { error } = await adminClient.storage.from(jobFilesBucket).remove(paths);
  if (error) throw error;
}

async function countRemainingQaStorageObjects(adminClient) {
  let remaining = 0;
  for (const object of qaStorageObjects()) {
    const separator = object.path.lastIndexOf('/');
    const folder = object.path.slice(0, separator);
    const name = object.path.slice(separator + 1);
    const { data, error } = await adminClient.storage.from(object.bucket).list(folder, { limit: 100, search: name });
    if (error) throw error;
    if ((data ?? []).some((entry) => entry.name === name)) remaining += 1;
  }
  return remaining;
}

async function countRemainingQaRows(adminClient) {
  const companyScopedTables = ['job_attachments', 'job_comments', 'job_materials', 'job_invoices', 'job_payments', 'appointments', 'jobs', 'customer_locations', 'customers', 'company_users', 'company_profiles', 'company_onboarding_steps', 'company_job_workflow_settings', 'company_job_types'];
  let total = 0;
  for (const table of companyScopedTables) {
    const { count, error } = await adminClient.from(table).select('company_id', { count: 'exact', head: true }).eq('company_id', qaCompanyId);
    if (error) throw error;
    total += count ?? 0;
  }
  const { count, error } = await adminClient.from('companies').select('id', { count: 'exact', head: true }).eq('id', qaCompanyId);
  if (error) throw error;
  return total + (count ?? 0);
}

export function createSyntheticPngBytes(scene) {
  const raw = new Uint8Array((imageSize * 3 + 1) * imageSize);
  let offset = 0;
  for (let y = 0; y < imageSize; y += 1) {
    raw[offset++] = 0;
    for (let x = 0; x < imageSize; x += 1) {
      const pixel = syntheticPixel(scene, x, y);
      raw[offset++] = pixel[0];
      raw[offset++] = pixel[1];
      raw[offset++] = pixel[2];
    }
  }
  const png = [
    ...pngSignature(),
    ...pngChunk('IHDR', uint32Bytes(imageSize), uint32Bytes(imageSize), [8, 2, 0, 0, 0]),
    ...pngChunk('IDAT', zlibNoCompression(raw)),
    ...pngChunk('IEND', []),
  ];
  return Uint8Array.from(png);
}

function syntheticPixel(scene, x, y) {
  const background = scene === 'result' ? [233, 243, 238] : [236, 241, 245];
  let color = [...background];
  const cabinet = x >= 108 && x <= 404 && y >= 146 && y <= 360;
  const panel = x >= 146 && x <= 366 && y >= 190 && y <= 312;
  const vent = y >= 218 && y <= 244 && x >= 168 && x <= 344 && x % 22 < 14;
  const pipe = x >= 256 && x <= 276 && y >= 92 && y <= 146;
  const base = x >= 84 && x <= 428 && y >= 360 && y <= 382;
  if (cabinet) color = scene === 'result' ? [196, 218, 205] : [198, 212, 224];
  if (panel) color = scene === 'result' ? [215, 231, 221] : [216, 226, 234];
  if (vent) color = [91, 112, 126];
  if (pipe || base) color = [125, 143, 138];
  if (scene === 'overview' && x >= 124 && x <= 180 && y >= 118 && y <= 156) color = [154, 171, 183];
  if (scene === 'result' && x >= 330 && x <= 380 && y >= 118 && y <= 168) color = [119, 180, 139];
  if (scene === 'result' && x >= 344 && x <= 368 && y >= 132 && y <= 156) color = [238, 248, 241];
  if ((x + y) % 47 === 0) color = color.map((value) => Math.max(0, value - 4));
  return color;
}

function pngSignature() {
  return [137, 80, 78, 71, 13, 10, 26, 10];
}

function pngChunk(type, ...parts) {
  const typeBytes = asciiBytes(type);
  const data = parts.flat();
  return [
    ...uint32Bytes(data.length),
    ...typeBytes,
    ...data,
    ...uint32Bytes(crc32([...typeBytes, ...data])),
  ];
}

function zlibNoCompression(data) {
  const blocks = [0x78, 0x01];
  for (let offset = 0; offset < data.length; offset += 65535) {
    const chunk = data.slice(offset, offset + 65535);
    const final = offset + 65535 >= data.length ? 1 : 0;
    blocks.push(final, chunk.length & 255, (chunk.length >> 8) & 255, (~chunk.length) & 255, ((~chunk.length) >> 8) & 255, ...chunk);
  }
  blocks.push(...uint32Bytes(adler32(data)));
  return blocks;
}

function asciiBytes(value) {
  return [...value].map((char) => char.charCodeAt(0));
}

function uint32Bytes(value) {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
