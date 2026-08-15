import { scrubText } from './privacy.js';
import { cleanText } from './schemas.js';
import { assertAiAssistantAccess } from './access.js';
import { resolveCompanyVoiceContext } from './companyVoice.js';

export async function buildAuthorizedContext({ request, session, repository }) {
  const job = await repository.getJob(request.jobId);
  if (!job) throw new Error('JOB_NOT_FOUND');
  if (!['Completed', 'Warranty'].includes(String(job.status))) throw new Error('UNSUPPORTED_STATUS');
  const company = await repository.getCompany(job.company_id);
  if (!company) throw new Error('JOB_NOT_FOUND');
  const companyUser = await repository.getCompanyUser(session, company.id);
  assertAiAssistantAccess({ session, company, companyUser });
  if (String(job.company_id) !== String(company.id)) throw new Error('FORBIDDEN');
  const [companyVoiceSettings, customer, location, materials, attachments, invoices, comments] = await Promise.all([
    repository.getCompanyVoiceSettings ? repository.getCompanyVoiceSettings(company.id) : null,
    repository.getCustomer(job.customer_id),
    repository.getLocation(job.customer_location_id),
    repository.listMaterials(company.id, job.id),
    repository.listAttachments(company.id, job.id),
    repository.listInvoices(company.id, job.id),
    repository.listComments(company.id, job.id),
  ]);
  const privateSource = { job, customer, location, invoices, comments };
  const privateValuesForInputScrubbing = buildPrivateValues(privateSource);
  const privateValuesForLeakDetection = buildPrivateValuesForLeakDetection(privateSource);
  const mediaStateById = new Map(request.mediaState.map((item) => [item.id, item]));
  const evidence = [
    claim('system-equipment', 'System/equipment', job.system, 'Job issue', privateValuesForInputScrubbing),
    claim('complaint', 'Complaint/issue', job.issue, 'Job issue', privateValuesForInputScrubbing),
    claim('diagnosis', 'Diagnosis', request.localFacts.diagnosis, 'Technician-entered fact', privateValuesForInputScrubbing),
    claim('repair-performed', 'Repair performed', request.localFacts.repairPerformed, 'Technician-entered fact', privateValuesForInputScrubbing),
    ...(materials ?? [])
      .filter((material) => String(material.company_id) === String(company.id) && String(material.job_id) === String(job.id) && material.status === 'Installed')
      .map((material, index) => claim(`installed-material-${index}`, 'Installed material', material.name, 'Installed material', privateValuesForInputScrubbing)),
    claim('final-result', 'Final result', request.localFacts.finalResult, 'Technician-entered fact', privateValuesForInputScrubbing),
    ...(attachments ?? [])
      .filter((attachment) => String(attachment.company_id) === String(company.id) && String(attachment.job_id) === String(job.id))
      .filter((attachment) => /^photo$/i.test(String(attachment.kind)) || /^video\//i.test(String(attachment.mime_type)))
      .filter((attachment) => mediaStateById.get(String(attachment.id))?.selected !== false)
      .sort((left, right) => (mediaStateById.get(String(left.id))?.order ?? 0) - (mediaStateById.get(String(right.id))?.order ?? 0))
      .map((attachment) => {
        const state = mediaStateById.get(String(attachment.id));
        return claim(`attachment-${attachment.id}`, state?.label ? `Selected media: ${state.label}` : 'Selected media', `${attachment.kind} attachment metadata: ${attachment.mime_type}`, 'Attachment metadata', privateValuesForInputScrubbing);
      }),
  ].filter(Boolean);
  return {
    jobId: job.id,
    companyId: company.id,
    actorId: actorId(session),
    actorAuthUserId: String(session.auth_user_id ?? ''),
    status: job.status,
    missingInformation: [
      request.localFacts.diagnosis ? '' : 'Diagnosis missing',
      request.localFacts.repairPerformed ? '' : 'Repair performed missing',
      request.localFacts.finalResult ? '' : 'Final result missing',
    ].filter(Boolean),
    evidence,
    privateValuesForInputScrubbing,
    privateValuesForLeakDetection,
    companyVoice: resolveCompanyVoiceContext(companyVoiceSettings, request.channel),
  };
}

export function buildPrivateValues({ job, customer, location, invoices = [], comments = [] }) {
  return unique([
    job.job_number,
    job.notes,
    job.service_call_fee_cents,
    job.labor_cents,
    customer?.organization,
    customer?.primary_name,
    customer?.primary_email,
    customer?.primary_phone,
    customer?.notes,
    location?.address,
    ...invoices.flatMap((invoice) => [invoice.invoice_number, invoice.amount_cents, invoice.status]),
    ...comments.map((comment) => comment.message),
  ]);
}

export function buildPrivateValuesForLeakDetection({ job, customer, location, invoices = [], comments = [] }) {
  return uniqueDescriptors([
    descriptor(job.job_number, 'JOB_IDENTIFIER'),
    descriptor(job.notes, 'FREE_TEXT_NOTE'),
    descriptor(job.service_call_fee_cents, 'MONEY_NUMERIC'),
    descriptor(job.labor_cents, 'MONEY_NUMERIC'),
    descriptor(customer?.organization, 'PERSON_OR_ORGANIZATION'),
    descriptor(customer?.primary_name, 'PERSON_OR_ORGANIZATION'),
    descriptor(customer?.primary_email, 'STRUCTURED_EMAIL'),
    descriptor(customer?.primary_phone, 'STRUCTURED_PHONE'),
    descriptor(customer?.notes, 'FREE_TEXT_NOTE'),
    descriptor(location?.address, 'STRUCTURED_ADDRESS'),
    ...invoices.flatMap((invoice) => [
      descriptor(invoice.invoice_number, 'INVOICE_IDENTIFIER'),
      descriptor(invoice.amount_cents, 'MONEY_NUMERIC'),
      descriptor(invoice.status, 'ENUM_OR_STATUS'),
    ]),
    ...comments.map((comment) => descriptor(comment.message, 'FREE_TEXT_COMMENT')),
  ].filter(Boolean));
}

function claim(id, label, value, source, privateValues) {
  const text = scrubText(cleanText(value, 700), privateValues);
  return text ? { id, label, text, source } : undefined;
}

function actorId(session) {
  return String(session.user_id ?? session.auth_user_id ?? session.id ?? session.email ?? 'unknown');
}

function unique(values) {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)));
}

function descriptor(value, classification) {
  const clean = String(value ?? '').trim();
  return clean ? { value: clean, classification } : undefined;
}

function uniqueDescriptors(values) {
  const seen = new Set();
  return values.filter((entry) => {
    const key = `${entry.classification}:${entry.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
