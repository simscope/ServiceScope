const knownPages = new Set(['jobInbox', 'jobs', 'allJobs', 'debtors', 'calendar', 'materials', 'warehouse', 'tasks', 'map', 'email', 'finances', 'aiBusiness', 'aiAssistant', 'knowledge', 'import', 'portal', 'onboarding']);

export function assertAiAssistantAccess({ session, company, companyUser }) {
  if (!session) throw new Error('AUTH_REQUIRED');
  if (session.kind !== 'company') throw new Error('FORBIDDEN');
  if (String(session.company_id ?? '') !== String(company.id ?? '')) throw new Error('FORBIDDEN');
  const isCompanyOwner = String(session.email ?? '').trim().toLowerCase() === String(company.owner_email ?? '').trim().toLowerCase();
  if (isCompanyOwner) return;
  if (!companyUser || companyUser.status !== 'active') throw new Error('FORBIDDEN');
  if (String(companyUser.company_id) !== String(company.id)) throw new Error('FORBIDDEN');
  const companyLevel = levelFor(company.access_rules, 'aiAssistant', 'full');
  const userLevel = levelFor(companyUser.portal_access_rules, 'aiAssistant', companyUser.role === 'technician' ? 'off' : 'full');
  if (combineAccessLevels(companyLevel, userLevel) === 'off') throw new Error('FORBIDDEN');
}

export function combineAccessLevels(companyLevel, userLevel) {
  if (companyLevel === 'off' || userLevel === 'off') return 'off';
  if (companyLevel === 'readonly' || userLevel === 'readonly') return 'readonly';
  return 'full';
}

function levelFor(rules, page, fallback) {
  if (!knownPages.has(page)) return fallback;
  const value = rules && typeof rules === 'object' ? rules[page] : undefined;
  return value === 'full' || value === 'readonly' || value === 'off' ? value : fallback;
}
