import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Building2, ClipboardList, Copy, CreditCard, Globe2, MailPlus, Plus, ShieldCheck, UserPlus, Users } from 'lucide-react';
import type { EmailConnection, EmailProvider } from '../../appTypes';
import { paymentMethodLabels } from '../../appLabels';
import { getPlan } from '../../services/billingCatalog';
import { money } from '../../utils/format';
import type {
  Company,
  CompanyOnboardingProfile,
  CompanyPaymentMethod,
  CompanyTechnician,
  CompanyTechnicianRole,
  NewCompanyJobTypeForm,
  NewCompanyTechnicianForm,
} from '../../types';
import { MiniStat } from '../OwnerPages';
import { SetupGuide } from './SetupGuide';
import { companyUserPageAccessDefinitions, defaultCompanyUserPageAccess, normalizeCompanyUserPageAccess } from '../../features/access/companyUserAccess';

type ProfessionTemplate = NewCompanyJobTypeForm & { id: string };

export function OnboardingPage({
  completedSteps,
  profile,
  emailConnection,
  handleLogoUpload,
  updateProfile,
  connectMailbox,
  emailProviderLabels,
  updateMailbox,
  togglePaymentMethod,
  professionTemplates,
  configuredProfessionNames,
  addProfessionTemplate,
  jobTypeForm,
  setJobTypeForm,
  handleJobTypeSubmit,
  removeJobType,
  technicianForm,
  setTechnicianForm,
  selectedCompany,
  handleTechnicianSubmit,
  onSendTechnicianAccess,
  technicianAccessStatusById,
  technicianAccessPasswordById,
  setTechnicianAccessPasswordById,
  ownerAccessPassword,
  ownerAccessPasswordConfirm,
  ownerAccessStatus,
  setOwnerAccessPassword,
  setOwnerAccessPasswordConfirm,
  onGenerateOwnerPassword,
  onSaveOwnerPassword,
  mailboxConnectStatus,
  mailboxOAuthSecretDraft,
  mailboxOAuthStatus,
  mailboxOAuthRedirectUrl,
  setMailboxOAuthSecretDraft,
  onCopyMailboxRedirectUrl,
  onSaveMailboxOAuth,
  onStartMailboxConnection,
  billingStatus,
  onConnectSubscriptionBilling,
}: {
  completedSteps: number;
  profile: CompanyOnboardingProfile;
  emailConnection: EmailConnection | null;
  handleLogoUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  updateProfile: (updates: Partial<CompanyOnboardingProfile>) => void;
  connectMailbox: (provider: EmailProvider) => void;
  emailProviderLabels: Record<EmailProvider, string>;
  updateMailbox: (patch: Partial<EmailConnection>) => void;
  togglePaymentMethod: (method: CompanyPaymentMethod) => void;
  professionTemplates: ProfessionTemplate[];
  configuredProfessionNames: Set<string>;
  addProfessionTemplate: (template: ProfessionTemplate) => void;
  jobTypeForm: NewCompanyJobTypeForm;
  setJobTypeForm: (form: NewCompanyJobTypeForm) => void;
  handleJobTypeSubmit: (event: FormEvent<HTMLFormElement>) => void;
  removeJobType: (jobTypeId: string) => void;
  technicianForm: NewCompanyTechnicianForm;
  setTechnicianForm: (form: NewCompanyTechnicianForm) => void;
  selectedCompany: Company;
  handleTechnicianSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSendTechnicianAccess: (technicianId: string, mode: 'create' | 'reset', password: string) => void;
  technicianAccessStatusById: Record<string, string>;
  technicianAccessPasswordById: Record<string, string>;
  setTechnicianAccessPasswordById: (passwords: Record<string, string>) => void;
  ownerAccessPassword: string;
  ownerAccessPasswordConfirm: string;
  ownerAccessStatus: string;
  setOwnerAccessPassword: (password: string) => void;
  setOwnerAccessPasswordConfirm: (password: string) => void;
  onGenerateOwnerPassword: () => void;
  onSaveOwnerPassword: () => void;
  mailboxConnectStatus: string;
  mailboxOAuthSecretDraft: string;
  mailboxOAuthStatus: string;
  mailboxOAuthRedirectUrl: string;
  setMailboxOAuthSecretDraft: (secret: string) => void;
  onCopyMailboxRedirectUrl: () => void;
  onSaveMailboxOAuth: () => void;
  onStartMailboxConnection: () => void;
  billingStatus: string;
  onConnectSubscriptionBilling: () => void;
}) {
  const selectedPlan = getPlan(selectedCompany.plan);
  const technicianLimit = selectedPlan.technicians;
  const technicianLimitReached = profile.technicians.length >= technicianLimit;
  const [technicianEditorId, setTechnicianEditorId] = useState<string | null>('');
  const [websiteIntakeCopyStatus, setWebsiteIntakeCopyStatus] = useState('');
  const [technicianDraft, setTechnicianDraft] = useState<NewCompanyTechnicianForm & { status: CompanyTechnician['status']; pageAccess: CompanyTechnician['pageAccess'] }>({
    name: '',
    email: '',
    phone: '',
    photoUrl: '',
    accessPassword: '',
    role: technicianForm.role,
    status: 'invited',
    pageAccess: defaultCompanyUserPageAccess(technicianForm.role),
  });
  const subscriptionConnected = profile.subscriptionPaymentStatus === 'active' && profile.autoPayEnabled;
  const subscriptionStatusLabel =
    profile.subscriptionPaymentStatus === 'not_connected'
      ? 'Not connected'
      : profile.subscriptionPaymentStatus === 'pending'
        ? 'Pending verification'
        : profile.subscriptionPaymentStatus === 'active'
          ? 'Active'
          : 'Failed';
  const generatedMailboxSignature = [
    profile.displayName || selectedCompany.name,
    profile.serviceAddress,
    profile.phone ? `Phone: ${profile.phone}` : '',
    profile.website ? `Website: ${profile.website}` : '',
    'HVAC and Appliance Repair',
    profile.serviceArea ? `Serving ${profile.serviceArea}` : '',
  ].filter(Boolean).join('\n');
  const sendingIdentityReady = Boolean(
    emailConnection?.senderName.trim() &&
    emailConnection.replyTo.trim() &&
    emailConnection.signature.trim(),
  );
  const viteEnv = (import.meta as unknown as { env?: { VITE_SUPABASE_URL?: string } }).env ?? {};
  const websiteIntakeEndpoint = viteEnv.VITE_SUPABASE_URL
    ? `${viteEnv.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/website-intake`
    : 'https://YOUR-PROJECT.supabase.co/functions/v1/website-intake';
  const websiteIntakeToken = profile.websiteIntakeToken || 'generate-a-token-first';
  const leadWebhookEndpoint = viteEnv.VITE_SUPABASE_URL
    ? `${viteEnv.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/lead-webhook`
    : 'https://YOUR-PROJECT.supabase.co/functions/v1/lead-webhook';
  const websiteIntakeSnippet = `<div id="servicescope-widget" class="servicescope-widget">
  <button id="servicescope-widget-tab" class="servicescope-widget-tab" type="button" aria-expanded="false">
    <span>Request service</span>
  </button>
  <div id="servicescope-widget-panel" class="servicescope-widget-panel" hidden>
    <div class="servicescope-widget-header">
      <strong>Request service</strong>
      <button id="servicescope-widget-close" type="button" aria-label="Close request form">&times;</button>
    </div>
    <form id="servicescope-request-form" class="servicescope-request-form">
      <input name="name" placeholder="Name" required>
      <input name="phone" placeholder="Phone">
      <input name="email" type="email" placeholder="Email">
      <input name="address" placeholder="Service address">
      <textarea name="message" placeholder="How can we help?"></textarea>
      <input name="website" tabindex="-1" autocomplete="off" style="display:none">
      <button type="submit">Send request</button>
      <p id="servicescope-widget-status" class="servicescope-widget-status" aria-live="polite"></p>
    </form>
  </div>
</div>
<style>
  .servicescope-widget {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 2147483000;
    font-family: Arial, sans-serif;
  }
  .servicescope-widget-tab {
    border: 0;
    border-radius: 999px;
    background: #10251b;
    color: #ffffff;
    box-shadow: 0 12px 30px rgba(16, 37, 27, 0.22);
    padding: 14px 18px;
    font-size: 15px;
    font-weight: 800;
    cursor: pointer;
  }
  .servicescope-widget-tab:hover { background: #173827; }
  .servicescope-widget-panel {
    width: min(360px, calc(100vw - 28px));
    margin-bottom: 10px;
    border: 1px solid #d8e1dc;
    border-radius: 14px;
    background: #ffffff;
    box-shadow: 0 20px 60px rgba(15, 23, 42, 0.24);
    overflow: hidden;
  }
  .servicescope-widget-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f5f8f6;
    padding: 14px 16px;
  }
  .servicescope-widget-header strong { color: #10251b; font-size: 17px; }
  .servicescope-widget-header button {
    width: 32px;
    height: 32px;
    border: 1px solid #d8e1dc;
    border-radius: 999px;
    background: #ffffff;
    color: #10251b;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }
  .servicescope-request-form {
    display: grid;
    gap: 10px;
    padding: 14px 16px 16px;
  }
  .servicescope-request-form input,
  .servicescope-request-form textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid #cfd9d3;
    border-radius: 9px;
    padding: 11px 12px;
    color: #10251b;
    font: inherit;
    font-size: 14px;
  }
  .servicescope-request-form textarea {
    min-height: 92px;
    resize: vertical;
  }
  .servicescope-request-form button[type="submit"] {
    border: 0;
    border-radius: 9px;
    background: #10251b;
    color: #ffffff;
    padding: 12px 14px;
    font-size: 15px;
    font-weight: 800;
    cursor: pointer;
  }
  .servicescope-request-form button[type="submit"]:hover { background: #173827; }
  .servicescope-widget-status {
    min-height: 18px;
    margin: 0;
    color: #52635a;
    font-size: 13px;
    font-weight: 700;
  }
  @media (max-width: 520px) {
    .servicescope-widget {
      right: 12px;
      bottom: 12px;
      left: 12px;
    }
    .servicescope-widget-panel { width: 100%; }
    .servicescope-widget-tab { width: 100%; }
  }
</style>
<script>
(() => {
  const endpoint = '${websiteIntakeEndpoint}';
  const token = '${websiteIntakeToken}';
  const tab = document.getElementById('servicescope-widget-tab');
  const panel = document.getElementById('servicescope-widget-panel');
  const close = document.getElementById('servicescope-widget-close');
  const form = document.getElementById('servicescope-request-form');
  const status = document.getElementById('servicescope-widget-status');

  function setOpen(open) {
    panel.hidden = !open;
    tab.setAttribute('aria-expanded', String(open));
  }

  tab.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => setOpen(false));

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    status.textContent = 'Sending...';
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, source: 'website', ...data })
      });
      if (!response.ok) throw new Error('Request could not be sent.');
      form.reset();
      status.textContent = 'Request sent. We will contact you soon.';
      window.setTimeout(() => setOpen(false), 1400);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Request could not be sent.';
    }
  });
})();
</script>`;

  function generateWebsiteIntakeToken() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    updateProfile({ websiteIntakeToken: token, websiteIntakeEnabled: true });
    setWebsiteIntakeCopyStatus('');
  }

  function copyWebsiteIntakeSnippet() {
    void navigator.clipboard.writeText(websiteIntakeSnippet)
      .then(() => setWebsiteIntakeCopyStatus('Copied.'))
      .catch(() => setWebsiteIntakeCopyStatus('Copy failed.'));
  }

  function generateLeadApiToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    updateProfile({ leadApiToken: token, leadApiEnabled: true });
    setWebsiteIntakeCopyStatus('Lead integration token generated. Save onboarding to activate it.');
  }

  function copyLeadWebhookEndpoint() {
    void navigator.clipboard.writeText(leadWebhookEndpoint)
      .then(() => setWebsiteIntakeCopyStatus('Webhook endpoint copied.'))
      .catch(() => setWebsiteIntakeCopyStatus('Copy failed.'));
  }

  function updateTechnician(technicianId: string, updates: Partial<CompanyOnboardingProfile['technicians'][number]>) {
    updateProfile({
      technicians: profile.technicians.map((technician) =>
        technician.id === technicianId ? { ...technician, ...updates } : technician,
      ),
    });
  }

  function openNewTechnicianModal() {
    if (technicianLimitReached) return;

    setTechnicianEditorId(null);
    setTechnicianDraft({
      name: '',
      email: '',
      phone: '',
      photoUrl: '',
      accessPassword: '',
      role: technicianForm.role,
      status: 'invited',
      pageAccess: defaultCompanyUserPageAccess(technicianForm.role),
    });
  }

  function openEditTechnicianModal(technician: CompanyTechnician) {
    setTechnicianEditorId(technician.id);
    setTechnicianDraft({
      name: technician.name,
      email: technician.email,
      phone: technician.phone,
      photoUrl: technician.photoUrl,
      accessPassword: technicianAccessPasswordById[technician.id] ?? technician.accessPassword ?? '',
      role: technician.role,
      status: technician.status,
      pageAccess: normalizeCompanyUserPageAccess(technician.pageAccess, technician.role),
    });
  }

  function closeTechnicianModal() {
    setTechnicianEditorId('');
  }

  function persistTechnicianDraft() {
    if (!technicianDraft.name.trim() || !technicianDraft.email.trim()) return '';

    if (technicianEditorId) {
      updateProfile({
        technicians: profile.technicians.map((technician) =>
          technician.id === technicianEditorId
            ? {
                ...technician,
                name: technicianDraft.name.trim(),
                email: technicianDraft.email.trim(),
                phone: technicianDraft.phone.trim(),
                photoUrl: technicianDraft.photoUrl,
                role: technicianDraft.role,
                status: technicianDraft.status,
                accessPassword: technicianDraft.accessPassword,
                pageAccess: technicianDraft.pageAccess,
              }
            : technician,
        ),
      });
      setTechnicianAccessPasswordById({
        ...technicianAccessPasswordById,
        [technicianEditorId]: technicianDraft.accessPassword,
      });
      return technicianEditorId;
    } else {
      if (technicianLimitReached) return '';
      const technician: CompanyTechnician = {
        id: crypto.randomUUID(),
        name: technicianDraft.name.trim(),
        email: technicianDraft.email.trim(),
        phone: technicianDraft.phone.trim(),
        photoUrl: technicianDraft.photoUrl,
        accessPassword: technicianDraft.accessPassword,
        role: technicianDraft.role,
        status: technicianDraft.status,
        assignedJobs: 0,
        pageAccess: technicianDraft.pageAccess,
      };
      updateProfile({
        technicians: [technician, ...profile.technicians],
      });
      if (technicianDraft.accessPassword) {
        setTechnicianAccessPasswordById({
          ...technicianAccessPasswordById,
          [technician.id]: technicianDraft.accessPassword,
        });
      }
      return technician.id;
    }
  }

  function saveTechnicianDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const technicianId = persistTechnicianDraft();
    if (!technicianId) return;

    closeTechnicianModal();
  }

  function handleTechnicianPhotoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setTechnicianDraft((draft) => ({ ...draft, photoUrl: String(reader.result ?? '') }));
    });
    reader.readAsDataURL(file);
  }

  function generateTechnicianDraftPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
    const values = new Uint32Array(12);
    crypto.getRandomValues(values);
    const password = Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
    setTechnicianDraft((draft) => ({ ...draft, accessPassword: password }));
  }

  return (<>
          <section className="client-onboarding">
            <div className="onboarding-header">
              <div>
                <p className="eyebrow">Company onboarding</p>
                <h1>Workspace setup</h1>
                <p>Set up the company, team access, job workflow, billing, and launch readiness before daily operations begin.</p>
              </div>
              <div className="onboarding-progress">
                <strong>{completedSteps}/4</strong>
                <span>Provisioning steps</span>
              </div>
            </div>

            <div className="onboarding-grid">
              <section className="panel company-profile-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Company data</p>
                    <h2>Profile and logo</h2>
                  </div>
                  <Building2 size={20} aria-hidden="true" />
                </div>
                <SetupGuide
                  title="Step-by-step setup guide"
                  intro="Complete the company profile once. These details appear on invoices, emails, the website request form, and technician screens."
                  prepare="Company legal name, public business name, main phone, service address, website, and logo."
                  steps={[
                    'Enter the legal company name used for documents and billing.',
                    'Enter the display name customers and technicians should see.',
                    'Add the website, main phone, billing email, emergency contact, and service address.',
                    'Choose the service area and the company time zone.',
                    'Upload a square logo, then review the fields before leaving this page.',
                  ]}
                  complete="The company identity is complete and the same information is ready to reuse across the workspace."
                />
                <div className="company-profile-layout">
                  <div className="logo-uploader">
                    <div className="logo-preview">
                      {profile.logoUrl ? (
                        <img src={profile.logoUrl} alt={`${profile.displayName} logo`} />
                      ) : (
                        <span>{profile.displayName.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <label className="secondary-button compact">
                      Upload logo
                      <input type="file" accept="image/*" onChange={handleLogoUpload} />
                    </label>
                  </div>
                  <div className="profile-fields">
                    <label>
                      Legal company name
                      <input value={profile.legalName} onChange={(event) => updateProfile({ legalName: event.target.value })} />
                    </label>
                    <label>
                      Display name
                      <input value={profile.displayName} onChange={(event) => updateProfile({ displayName: event.target.value })} />
                    </label>
                    <label>
                      Website
                      <input value={profile.website} onChange={(event) => updateProfile({ website: event.target.value })} placeholder="https://company.com" />
                    </label>
                    <label>
                      Main phone
                      <input value={profile.phone} onChange={(event) => updateProfile({ phone: event.target.value })} placeholder="(555) 000-0000" />
                    </label>
                    <label>
                      Billing email
                      <input type="email" value={profile.billingEmail} onChange={(event) => updateProfile({ billingEmail: event.target.value })} />
                    </label>
                    <label>
                      Emergency contact
                      <input value={profile.emergencyContact} onChange={(event) => updateProfile({ emergencyContact: event.target.value })} />
                    </label>
                    <label className="profile-wide">
                      Service address
                      <input value={profile.serviceAddress} onChange={(event) => updateProfile({ serviceAddress: event.target.value })} placeholder="Main office or dispatch address" />
                    </label>
                    <label>
                      Service area
                      <input value={profile.serviceArea} onChange={(event) => updateProfile({ serviceArea: event.target.value })} />
                    </label>
                    <label>
                      Timezone
                      <select value={profile.timezone} onChange={(event) => updateProfile({ timezone: event.target.value })}>
                        <option value="America/New_York">Eastern</option>
                        <option value="America/Chicago">Central</option>
                        <option value="America/Denver">Mountain</option>
                        <option value="America/Los_Angeles">Pacific</option>
                      </select>
                    </label>
                  </div>
                </div>
              </section>

              <section className="panel website-intake-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Website requests</p>
                    <h2>Public service form</h2>
                  </div>
                  <Globe2 size={20} aria-hidden="true" />
                </div>
                <SetupGuide
                  title="Step-by-step setup guide"
                  intro="The website form creates a Job Inbox request first. The office can review it and convert it into a job later."
                  prepare="Access to the company website and permission to paste one code snippet before the closing body tag."
                  steps={[
                    'Turn on website submissions to enable the public request form.',
                    'Generate the public token and keep it private from website visitors.',
                    'Enter every allowed website domain, one per line, including the www version if used.',
                    'Copy the floating widget code and paste it before the closing body tag on the website.',
                    'Open the website in a private window, submit a test request, and confirm it appears in Job Inbox.',
                  ]}
                  complete="A visitor can open the small Request service tab, submit a request, and the office can see it as a new intake."
                />
                <div className="website-intake-grid">
                  <label className="mailbox-check website-intake-toggle">
                    <input
                      type="checkbox"
                      checked={profile.websiteIntakeEnabled}
                      onChange={(event) => updateProfile({ websiteIntakeEnabled: event.target.checked })}
                    />
                    <span>
                      <strong>Send website form submissions to Job Inbox</strong>
                      <small>New website requests stay as intake records until the office converts them to jobs.</small>
                    </span>
                  </label>
                  <label>
                    Public token
                    <div className="copy-field-row">
                      <input value={profile.websiteIntakeToken} onChange={(event) => updateProfile({ websiteIntakeToken: event.target.value.trim() })} placeholder="Generate a token" />
                      <button className="secondary-button compact" type="button" onClick={generateWebsiteIntakeToken}>
                        Generate
                      </button>
                    </div>
                  </label>
                  <label>
                    Allowed website domains
                    <textarea
                      value={profile.websiteIntakeAllowedOrigins}
                      onChange={(event) => updateProfile({ websiteIntakeAllowedOrigins: event.target.value })}
                      placeholder="https://company.com&#10;https://www.company.com"
                    />
                    <span className="mailbox-helper-text">One domain per line. Leave empty only while testing.</span>
                  </label>
                  <label>
                    Intake endpoint
                    <input value={websiteIntakeEndpoint} readOnly />
                  </label>
                </div>
                <div className="website-intake-snippet">
                  <div className="mailbox-step-heading">
                    <div>
                      <strong>Floating request widget</strong>
                      <p>Paste this before the closing body tag. It shows a small service request tab on the website.</p>
                    </div>
                    <button className="secondary-button compact" type="button" onClick={copyWebsiteIntakeSnippet}>
                      <Copy size={15} aria-hidden="true" />
                      Copy
                    </button>
                  </div>
                  <textarea value={websiteIntakeSnippet} readOnly />
                  {websiteIntakeCopyStatus ? <span className="mailbox-helper-text">{websiteIntakeCopyStatus}</span> : null}
                </div>
              </section>

              <section className="panel lead-integrations-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Lead integrations</p>
                    <h2>Thumbtack, Yelp, Angi and other providers</h2>
                  </div>
                  <Globe2 size={20} aria-hidden="true" />
                </div>
                <SetupGuide
                  title="Step-by-step setup guide"
                  intro="Partner leads are accepted into Job Inbox before anyone creates a job, so duplicate or spam requests can be reviewed first."
                  prepare="A provider webhook/API screen and the provider's lead ID, contact, address, and message fields."
                  steps={[
                    'Turn on Accept partner leads.',
                    'Generate an integration token and store it in the provider password manager.',
                    'Copy the webhook endpoint into Thumbtack, Yelp, Angi, or another lead provider.',
                    'Map the provider lead ID to externalId and send provider, name, phone, email, address, and message.',
                    'Send one test lead and confirm it appears in Job Inbox with source Partner.',
                  ]}
                  complete="New leads arrive as intake records and repeated provider lead IDs are ignored automatically."
                />
                <div className="website-intake-grid">
                  <label className="mailbox-check website-intake-toggle">
                    <input type="checkbox" checked={profile.leadApiEnabled} onChange={(event) => updateProfile({ leadApiEnabled: event.target.checked })} />
                    <span>
                      <strong>Accept partner leads</strong>
                      <small>External services send new leads here before anyone creates a job.</small>
                    </span>
                  </label>
                  <label>
                    Webhook endpoint
                    <div className="copy-field-row">
                      <input value={leadWebhookEndpoint} readOnly />
                      <button className="secondary-button compact" type="button" onClick={copyLeadWebhookEndpoint}><Copy size={15} aria-hidden="true" /> Copy</button>
                    </div>
                  </label>
                  <label>
                    Integration token
                    <div className="copy-field-row">
                      <input type="password" value={profile.leadApiToken} onChange={(event) => updateProfile({ leadApiToken: event.target.value.trim() })} placeholder="Generate a token" autoComplete="new-password" />
                      <button className="secondary-button compact" type="button" onClick={generateLeadApiToken}>Generate</button>
                    </div>
                  </label>
                  <span className="mailbox-helper-text">Use the endpoint and token in a provider's webhook/API integration. Send provider, lead ID, name, phone, email, address, and message. Duplicate lead IDs are ignored.</span>
                </div>
              </section>

              <section className="panel owner-account-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Owner account</p>
                    <h2>Sign-in password</h2>
                  </div>
                  <ShieldCheck size={20} aria-hidden="true" />
                </div>
                <SetupGuide
                  title="Step-by-step setup guide"
                  intro="Set the company owner's password here so the owner can sign in without waiting for support."
                  prepare="Use a unique password with at least 12 characters and store it in a password manager."
                  steps={[
                    'Confirm the owner email shown in this section.',
                    'Generate a strong password or enter one manually.',
                    'Enter the same password in the confirmation field.',
                    'Click Change password and wait for the success message.',
                    'Sign out and test the new credentials in a private browser window.',
                  ]}
                  complete="The owner can sign in with the displayed email and the new password."
                />
                <div className="owner-account-grid">
                  <div className="owner-account-summary">
                    <span>Company owner</span>
                    <strong>{selectedCompany.ownerName}</strong>
                    <p>{selectedCompany.ownerEmail}</p>
                  </div>
                  <label>
                    New password
                    <input
                      type="text"
                      value={ownerAccessPassword}
                      onChange={(event) => setOwnerAccessPassword(event.target.value)}
                      placeholder="Enter a new password"
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    Confirm password
                    <input
                      type="text"
                      value={ownerAccessPasswordConfirm}
                      onChange={(event) => setOwnerAccessPasswordConfirm(event.target.value)}
                      placeholder="Repeat the password"
                      autoComplete="new-password"
                    />
                  </label>
                </div>
                <div className="owner-account-actions">
                  <button className="secondary-button compact" type="button" onClick={onGenerateOwnerPassword}>
                    Generate password
                  </button>
                  <button className="primary-button compact" type="button" onClick={onSaveOwnerPassword}>
                    Change password
                  </button>
                  {ownerAccessStatus ? <p className="access-status">{ownerAccessStatus}</p> : null}
                </div>
              </section>

              <section className="panel workspace-mailbox-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Mailbox setup</p>
                    <h2>{emailConnection?.address || 'Configure company email'}</h2>
                  </div>
                  <MailPlus size={20} aria-hidden="true" />
                </div>
                <div className="mailbox-setup-content">
                  <div className="mailbox-step provider-step">
                    <div>
                      <strong>1. Provider</strong>
                      <p>Choose how this company mailbox will be connected.</p>
                    </div>
                    <div className="email-provider-actions">
                      {(['google', 'microsoft', 'smtp'] as EmailProvider[]).map((provider) => (
                        <button className={emailConnection?.provider === provider ? 'provider-button active' : 'provider-button'} type="button" onClick={() => connectMailbox(provider)} key={provider}>
                          {emailConnection?.provider === provider ? `${emailProviderLabels[provider]} selected` : emailProviderLabels[provider]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {emailConnection && emailConnection.provider !== 'smtp' ? (
                    <div className="mailbox-step oauth-setup-card">
                      <div>
                        <strong>2. Google / Microsoft app credentials</strong>
                        <p>
                          Create an OAuth app in the mailbox provider console, paste these values here, then connect the mailbox.
                        </p>
                      </div>
                      <div className="oauth-instructions">
                        <div>
                          <strong>Where to get this</strong>
                          <span>Google Cloud Console or Microsoft Azure Portal</span>
                        </div>
                        <div>
                          <strong>Required API</strong>
                          <span>{emailConnection.provider === 'google' ? 'Gmail API' : 'Microsoft Graph Mail.ReadWrite and Mail.Send'}</span>
                        </div>
                        <div>
                          <strong>Application type</strong>
                          <span>Web application</span>
                        </div>
                      </div>
                      <details className="oauth-cheatsheet">
                        <summary>Step-by-step setup guide</summary>
                        {emailConnection.provider === 'google' ? (
                          <ol>
                            <li>Open Google Cloud Console: console.cloud.google.com.</li>
                            <li>Create a new project or choose the company project.</li>
                            <li>Go to APIs & Services, then Library.</li>
                            <li>Search for Gmail API and click Enable.</li>
                            <li>Go to APIs & Services, then OAuth consent screen.</li>
                            <li>Choose External unless the company uses Google Workspace internal apps.</li>
                            <li>Enter the app name, support email, company domain, and developer contact email.</li>
                            <li>Go to APIs & Services, then Credentials.</li>
                            <li>Click Create credentials, then OAuth client ID.</li>
                            <li>Choose Web application.</li>
                            <li>Under Authorized redirect URIs, paste the redirect URL from ServiceScope.</li>
                            <li>Click Create, then copy Client ID and Client Secret into ServiceScope.</li>
                            <li>Click Save OAuth settings, then Connect mailbox.</li>
                          </ol>
                        ) : (
                          <ol>
                            <li>Open Microsoft Azure Portal: portal.azure.com.</li>
                            <li>Go to Microsoft Entra ID, then App registrations.</li>
                            <li>Click New registration.</li>
                            <li>Enter the app name, usually ServiceScope Mail.</li>
                            <li>Choose who can use this app for the company tenant.</li>
                            <li>Set Redirect URI type to Web.</li>
                            <li>Paste the redirect URL from ServiceScope.</li>
                            <li>Open API permissions and add Microsoft Graph permissions.</li>
                            <li>Add Mail.ReadWrite, Mail.Send, and offline_access.</li>
                            <li>Grant admin consent if Microsoft requires it.</li>
                            <li>Open Certificates & secrets, then create a new Client secret.</li>
                            <li>Copy Application client ID and Client secret value into ServiceScope.</li>
                            <li>Click Save OAuth settings, then Connect mailbox.</li>
                          </ol>
                        )}
                      </details>
                      <div className="mailbox-settings-grid">
                        <label className="profile-wide">
                          Company mailbox email
                          <input
                            type="email"
                            value={emailConnection.address}
                            onChange={(event) => updateMailbox({ address: event.target.value, replyTo: event.target.value })}
                            placeholder="dispatch@company.com"
                          />
                        </label>
                        <label className="profile-wide">
                          Authorized redirect URL
                          <div className="copy-field-row">
                            <input value={emailConnection.oauthRedirectUrl || mailboxOAuthRedirectUrl} readOnly />
                            <button className="secondary-button compact" type="button" onClick={onCopyMailboxRedirectUrl}>
                              Copy
                            </button>
                          </div>
                        </label>
                        <label>
                          Client ID
                          <input
                            value={emailConnection.oauthClientId}
                            onChange={(event) => updateMailbox({ oauthClientId: event.target.value })}
                            placeholder={emailConnection.provider === 'google' ? 'Google OAuth client ID' : 'Microsoft application client ID'}
                          />
                        </label>
                        <label>
                          Client secret
                          <input
                            type="password"
                            value={mailboxOAuthSecretDraft}
                            onChange={(event) => setMailboxOAuthSecretDraft(event.target.value)}
                            placeholder={emailConnection.oauthClientSecretSaved ? 'Secret saved - enter a new one to replace' : 'Paste client secret'}
                          />
                        </label>
                      </div>
                      <div className="mailbox-connect-actions">
                        <button className="primary-button compact" type="button" onClick={onSaveMailboxOAuth}>
                          Save OAuth settings
                        </button>
                        <span className={emailConnection.oauthClientSecretSaved ? 'saved-pill' : 'pending-pill'}>
                          {emailConnection.oauthClientSecretSaved ? 'Secret saved' : 'Secret required'}
                        </span>
                        {mailboxOAuthStatus ? <p className="access-status">{mailboxOAuthStatus}</p> : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mailbox-step">
                    <div>
                      <strong>{emailConnection?.provider === 'smtp' ? '2' : '3'}. Mailbox and permissions</strong>
                      <p>{emailConnection ? `${emailProviderLabels[emailConnection.provider]} settings are saved with this workspace.` : 'Select a provider to configure address, permissions, sync, and sending identity.'}</p>
                    </div>
                    <div className="mailbox-permissions">
                      <span>Read company mailbox</span>
                      <span>Send as company</span>
                      <span>Attach messages to jobs</span>
                      <span>Tenant isolated tokens</span>
                    </div>
                    <div className="mailbox-settings-grid">
                      {emailConnection?.provider === 'smtp' ? (
                        <label>
                          Mailbox address
                          <input value={emailConnection.address} onChange={(event) => updateMailbox({ address: event.target.value, replyTo: event.target.value })} placeholder="dispatch@company.com" />
                        </label>
                      ) : null}
                      <div className="mailbox-readiness-card">
                        <span>Connection</span>
                        <strong>{emailConnection?.status === 'connected' ? 'Connected' : emailConnection ? 'Ready to connect' : 'Not configured'}</strong>
                        <p>{emailConnection ? 'Save provider credentials, then connect the mailbox.' : 'Choose a provider first.'}</p>
                      </div>
                    </div>
                    <div className="mailbox-connect-actions">
                      <button className="primary-button compact" type="button" onClick={onStartMailboxConnection} disabled={!emailConnection}>
                        Connect mailbox
                      </button>
                      {mailboxConnectStatus ? <p className="access-status">{mailboxConnectStatus}</p> : null}
                    </div>
                  </div>

                  <div className="mailbox-step">
                    <div className="mailbox-step-heading">
                      <div>
                        <strong>{emailConnection?.provider === 'smtp' ? '3' : '4'}. Sync rules</strong>
                        <p>Choose how messages are imported and linked to operations.</p>
                      </div>
                      <span className="mailbox-status-pill">{emailConnection?.syncRange ?? '30'} days</span>
                    </div>
                    <div className="mailbox-sync-grid">
                      <label className="mailbox-sync-range">
                        Sync inbox from
                        <select value={emailConnection?.syncRange ?? '30'} onChange={(event) => updateMailbox({ syncRange: event.target.value as EmailConnection['syncRange'] })} disabled={!emailConnection}>
                          <option value="7">Last 7 days</option>
                          <option value="30">Last 30 days</option>
                          <option value="90">Last 90 days</option>
                        </select>
                      </label>
                      <label className="mailbox-check">
                        <input type="checkbox" checked={emailConnection?.autoLinkJobNumber ?? false} onChange={(event) => updateMailbox({ autoLinkJobNumber: event.target.checked })} disabled={!emailConnection} />
                        <span>
                          <strong>Auto-link by job number</strong>
                          <small>Match messages that mention an existing job number.</small>
                        </span>
                      </label>
                      <label className="mailbox-check">
                        <input type="checkbox" checked={emailConnection?.autoLinkClientEmail ?? false} onChange={(event) => updateMailbox({ autoLinkClientEmail: event.target.checked })} disabled={!emailConnection} />
                        <span>
                          <strong>Auto-link by client email</strong>
                          <small>Attach messages when the sender matches a job contact.</small>
                        </span>
                      </label>
                      <label className="mailbox-check">
                        <input type="checkbox" checked={emailConnection?.createTaskFromUnread ?? false} onChange={(event) => updateMailbox({ createTaskFromUnread: event.target.checked })} disabled={!emailConnection} />
                        <span>
                          <strong>Create task from unread client email</strong>
                          <small>Flag new client emails for follow-up.</small>
                        </span>
                      </label>
                      <label className="mailbox-check">
                        <input type="checkbox" checked={emailConnection?.importLeadsFromEmail ?? false} onChange={(event) => updateMailbox({ importLeadsFromEmail: event.target.checked })} disabled={!emailConnection} />
                        <span>
                          <strong>Import likely service requests to Job Inbox</strong>
                          <small>Only incoming emails matching service-request terms become new leads; they never become jobs automatically.</small>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="mailbox-step">
                    <div className="mailbox-step-heading">
                      <div>
                        <strong>{emailConnection?.provider === 'smtp' ? '4' : '5'}. Sending identity</strong>
                        <p>This is what customers see when the company sends email.</p>
                      </div>
                      <span className={sendingIdentityReady ? 'saved-pill' : 'pending-pill'}>
                        {sendingIdentityReady ? 'Ready' : 'Needs review'}
                      </span>
                    </div>
                    <div className="mailbox-settings-grid">
                      <label>
                        Sender name
                        <input value={emailConnection?.senderName ?? ''} onChange={(event) => updateMailbox({ senderName: event.target.value })} placeholder="Company name" disabled={!emailConnection} />
                      </label>
                      <label>
                        Reply-to email
                        <input type="email" value={emailConnection?.replyTo ?? ''} onChange={(event) => updateMailbox({ replyTo: event.target.value })} placeholder="dispatch@company.com" disabled={!emailConnection} />
                      </label>
                      <label className="profile-wide">
                        Signature
                        <textarea value={emailConnection?.signature ?? ''} onChange={(event) => updateMailbox({ signature: event.target.value })} placeholder="Company signature" disabled={!emailConnection} />
                      </label>
                    </div>
                    <div className="mailbox-connect-actions">
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => updateMailbox({
                          senderName: profile.displayName || selectedCompany.name,
                          replyTo: emailConnection?.address || emailConnection?.replyTo || profile.billingEmail,
                          signature: generatedMailboxSignature,
                        })}
                        disabled={!emailConnection}
                      >
                        Use company profile
                      </button>
                      <span className="mailbox-helper-text">Pulls name, address, phone, website, and service area from Company data.</span>
                    </div>
                  </div>

                  {emailConnection?.provider === 'smtp' ? (
                    <div className="mailbox-step">
                      <div>
                        <strong>5. SMTP / IMAP manual setup</strong>
                        <p>Use app password credentials from the mailbox provider.</p>
                      </div>
                      <div className="mailbox-settings-grid">
                        <label>
                          IMAP host
                          <input value={emailConnection.imapHost} onChange={(event) => updateMailbox({ imapHost: event.target.value })} />
                        </label>
                        <label>
                          IMAP port
                          <input value={emailConnection.imapPort} onChange={(event) => updateMailbox({ imapPort: event.target.value })} />
                        </label>
                        <label>
                          SMTP host
                          <input value={emailConnection.smtpHost} onChange={(event) => updateMailbox({ smtpHost: event.target.value })} />
                        </label>
                        <label>
                          SMTP port
                          <input value={emailConnection.smtpPort} onChange={(event) => updateMailbox({ smtpPort: event.target.value })} />
                        </label>
                        <label>
                          Security
                          <select value={emailConnection.security} onChange={(event) => updateMailbox({ security: event.target.value as EmailConnection['security'] })}>
                            <option value="ssl">SSL</option>
                            <option value="tls">TLS</option>
                            <option value="starttls">STARTTLS</option>
                          </select>
                        </label>
                        <label>
                          Username
                          <input value={emailConnection.username} onChange={(event) => updateMailbox({ username: event.target.value })} />
                        </label>
                        <label className="profile-wide">
                          App password
                          <input type="password" placeholder="Stored encrypted on backend" />
                        </label>
                      </div>
                    </div>
                  ) : null}

                  <div className="mailbox-test-row">
                    <div>
                      <strong>Mailbox readiness</strong>
                      <p>{emailConnection ? 'Mailbox connection is handled by Supabase Edge Functions. Provider credentials must be saved before OAuth connect.' : 'Select a provider and mailbox address first.'}</p>
                    </div>
                    <button className="secondary-button compact" type="button" onClick={onStartMailboxConnection} disabled={!emailConnection}>
                      Test connector
                    </button>
                  </div>
                </div>
              </section>

              <section className={`panel subscription-payment-panel ${subscriptionConnected ? 'connected' : ''}`}>
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">ServiceScope subscription</p>
                    <h2>Automatic billing</h2>
                  </div>
                  <CreditCard size={20} aria-hidden="true" />
                </div>
                <SetupGuide
                  title="Step-by-step setup guide"
                  intro="Connect subscription billing so the selected plan can renew automatically. Card details are handled by Square."
                  prepare="The billing owner's name, billing ZIP code, and a card authorized for recurring charges."
                  steps={[
                    'Enter the billing name and ZIP code exactly as the card statement shows them.',
                    'Turn on automatic monthly charges when the company is ready to be billed.',
                    'Click Connect Square billing and complete the secure Square checkout window.',
                    'Return to ServiceScope and confirm the status changes to Active.',
                  ]}
                  complete="The card is stored by Square, the plan status is Active, and the next renewal can run without manual support."
                />
                <div className="subscription-payment-layout">
                  <div className="subscription-payment-status">
                    <strong>{subscriptionConnected ? 'Autopay connected' : 'Payment method required'}</strong>
                    <p>
                      {selectedCompany.plan} plan - {money(selectedPlan.price)}/mo. ServiceScope charges this card automatically every billing cycle.
                    </p>
                    <span className={`subscription-status-pill ${profile.subscriptionPaymentStatus}`}>
                      {subscriptionStatusLabel}
                    </span>
                  </div>

                  <div className="subscription-card-preview">
                    <span>{profile.subscriptionCardBrand || 'Card'}</span>
                    <strong>{profile.subscriptionCardLast4 ? `**** ${profile.subscriptionCardLast4}` : 'No card on file'}</strong>
                    <small>
                      {profile.subscriptionCardExpMonth && profile.subscriptionCardExpYear
                        ? `Expires ${profile.subscriptionCardExpMonth}/${profile.subscriptionCardExpYear}`
                        : 'Expiration not added'}
                    </small>
                  </div>
                </div>

                <div className="subscription-payment-fields">
                  <label>
                    Billing name
                    <input value={profile.subscriptionBillingName} onChange={(event) => updateProfile({ subscriptionBillingName: event.target.value })} />
                  </label>
                  <label>
                    Billing ZIP
                    <input value={profile.subscriptionBillingZip} onChange={(event) => updateProfile({ subscriptionBillingZip: event.target.value })} />
                  </label>
                  <div className="readonly-status-field">
                    <span>Payment status</span>
                    <strong>{subscriptionStatusLabel}</strong>
                  </div>
                  <div className="readonly-status-field">
                    <span>Card on file</span>
                    <strong>{profile.subscriptionCardLast4 ? `${profile.subscriptionCardBrand || 'Card'} **** ${profile.subscriptionCardLast4}` : 'Not connected'}</strong>
                  </div>
                  <label className="checkbox-field prefix-toggle">
                    <input
                      type="checkbox"
                      checked={profile.autoPayEnabled}
                      onChange={(event) => updateProfile({ autoPayEnabled: event.target.checked })}
                    />
                    Enable automatic monthly charges
                  </label>
                  <button
                    className="primary-button compact"
                    type="button"
                    onClick={onConnectSubscriptionBilling}
                  >
                    Connect Square billing
                  </button>
                  {billingStatus ? <p className="access-status">{billingStatus}</p> : null}
                  <p className="subscription-safe-note">
                    Card numbers are collected by Square, not stored in ServiceScope.
                  </p>
                </div>
              </section>

              <section className="panel payment-setup-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Customer payments</p>
                    <h2>Accepted payments</h2>
                  </div>
                  <CreditCard size={20} aria-hidden="true" />
                </div>
                <SetupGuide
                  title="Step-by-step setup guide"
                  intro="Choose the payment methods your company accepts so staff can record payments consistently on jobs and invoices."
                  prepare="The company's preferred payment methods and any deposit or financing rules."
                  steps={[
                    'Select every payment method the office accepts.',
                    'Enter only the contact or account details needed to receive that method.',
                    'Add payment notes such as deposits, due dates, or financing instructions.',
                    'Review the selected methods before saving the company profile.',
                  ]}
                  complete="The accepted methods and instructions are available to the team when recording customer payments."
                />
                <div className="payment-method-grid">
                  {(Object.keys(paymentMethodLabels) as CompanyPaymentMethod[]).map((method) => (
                    <label className={`payment-method ${profile.acceptedPayments.includes(method) ? 'selected' : ''}`} key={method}>
                      <input
                        type="checkbox"
                        checked={profile.acceptedPayments.includes(method)}
                        onChange={() => togglePaymentMethod(method)}
                      />
                      <span>{paymentMethodLabels[method]}</span>
                    </label>
                  ))}
                </div>
                <div className="payment-fields">
                  <label>
                    ACH routing number
                    <input value={profile.achRoutingNumber} onChange={(event) => updateProfile({ achRoutingNumber: event.target.value })} placeholder="Routing number" />
                  </label>
                  <label>
                    ACH account number
                    <input value={profile.achAccountNumber} onChange={(event) => updateProfile({ achAccountNumber: event.target.value })} placeholder="Full account number" />
                  </label>
                  <label>
                    ACH account name
                    <input value={profile.achAccountName} onChange={(event) => updateProfile({ achAccountName: event.target.value })} placeholder="Business account name" />
                  </label>
                  <label>
                    Zelle contact
                    <input value={profile.zelleContact} onChange={(event) => updateProfile({ zelleContact: event.target.value })} placeholder="Email or phone" />
                  </label>
                  <label>
                    Venmo contact
                    <input value={profile.venmoContact} onChange={(event) => updateProfile({ venmoContact: event.target.value })} placeholder="@business or phone" />
                  </label>
                  <label>
                    Cash App cashtag
                    <input value={profile.cashAppCashtag} onChange={(event) => updateProfile({ cashAppCashtag: event.target.value })} placeholder="$business" />
                  </label>
                  <label>
                    PayPal email
                    <input type="email" value={profile.paypalEmail} onChange={(event) => updateProfile({ paypalEmail: event.target.value })} placeholder="payments@company.com" />
                  </label>
                  <label className="profile-wide">
                    Payment notes
                    <textarea value={profile.paymentNotes} onChange={(event) => updateProfile({ paymentNotes: event.target.value })} placeholder="Deposit rules, preferred payment method, financing notes, or payment instructions." />
                  </label>
                </div>
              </section>

              <section className="panel job-workflow-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Job workflow</p>
                    <h2>Job types and defaults</h2>
                  </div>
                  <ClipboardList size={20} aria-hidden="true" />
                </div>
                <SetupGuide
                  title="Step-by-step setup guide"
                  intro="Set the rules that control job numbers, warranty handling, completion requirements, and automatic archiving."
                  prepare="The default service call fee, warranty duration, archive timing, and professions the company offers."
                  steps={[
                    'Set the default service call fee and warranty period.',
                    'Choose how long completed and cancelled jobs remain active before archiving.',
                    'Turn on job prefixes if different professions need identifiable job numbers.',
                    'Enable completion notes and photos when the office needs proof before closing work.',
                    'Add suggested professions or create a custom profession with its job prefix.',
                  ]}
                  complete="New jobs use the selected defaults, technicians know what is required to finish work, and old jobs leave the active board automatically."
                />
                <div className="workflow-fields">
                  <label>
                    Default SCF ($)
                    <input type="number" min={0} step={5} value={profile.serviceCallFee} onChange={(event) => updateProfile({ serviceCallFee: Number(event.target.value) })} />
                  </label>
                  <label>
                    Warranty period (days)
                    <input type="number" min={0} step={1} value={profile.warrantyDays} onChange={(event) => updateProfile({ warrantyDays: Number(event.target.value) })} />
                  </label>
                  <label>
                    Archive completed after (days)
                    <input type="number" min={0} step={1} value={profile.autoArchiveCompletedAfterDays} onChange={(event) => updateProfile({ autoArchiveCompletedAfterDays: Number(event.target.value) })} />
                  </label>
                  <label>
                    Archive cancelled after (days)
                    <input type="number" min={0} step={1} value={profile.autoArchiveCancelledAfterDays} onChange={(event) => updateProfile({ autoArchiveCancelledAfterDays: Number(event.target.value) })} />
                  </label>
                  <label className="checkbox-field prefix-toggle">
                    <input
                      type="checkbox"
                      checked={profile.useJobNumberPrefixes}
                      onChange={(event) => updateProfile({ useJobNumberPrefixes: event.target.checked })}
                    />
                    Use profession prefixes for job numbers
                  </label>
                  <label className="checkbox-field prefix-toggle">
                    <input
                      type="checkbox"
                      checked={profile.requireCompletionNote}
                      onChange={(event) => updateProfile({ requireCompletionNote: event.target.checked })}
                    />
                    Require completion note before closing
                  </label>
                  <label className="checkbox-field prefix-toggle">
                    <input
                      type="checkbox"
                      checked={profile.requireCompletionPhoto}
                      onChange={(event) => updateProfile({ requireCompletionPhoto: event.target.checked })}
                    />
                    Require photo before closing
                  </label>
                  <label className="checkbox-field prefix-toggle">
                    <input
                      type="checkbox"
                      checked={profile.allowWarrantyReopen}
                      onChange={(event) => updateProfile({ allowWarrantyReopen: event.target.checked })}
                    />
                    Allow warranty reopen from completed jobs
                  </label>
                </div>
                <div className="workflow-rule-summary">
                  <span>Warranty ends {profile.warrantyDays} days after completion.</span>
                  <span>Completed jobs auto-archive after {profile.autoArchiveCompletedAfterDays} days.</span>
                  <span>Cancelled jobs auto-archive after {profile.autoArchiveCancelledAfterDays} days.</span>
                </div>
                <div className="profession-picker">
                  <p className="eyebrow">Suggested professions</p>
                  <div className="profession-chip-grid">
                    {professionTemplates.map((template) => {
                      const selected = configuredProfessionNames.has(String(template.name ?? '').toLowerCase());

                      return (
                        <button
                          className={`profession-chip ${selected ? 'selected' : ''}`}
                          type="button"
                          disabled={selected}
                          onClick={() => addProfessionTemplate(template)}
                          key={template.id}
                        >
                          <strong>{template.name}</strong>
                          <span>{template.jobNumberPrefix}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <form className="job-type-form" onSubmit={handleJobTypeSubmit}>
                  <label>
                    Profession
                    <input value={jobTypeForm.name} onChange={(event) => setJobTypeForm({ ...jobTypeForm, name: event.target.value })} placeholder="Garage Door" />
                  </label>
                  <label>
                    Job prefix
                    <input
                      value={jobTypeForm.jobNumberPrefix}
                      onChange={(event) => setJobTypeForm({ ...jobTypeForm, jobNumberPrefix: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                      placeholder="GAR"
                    />
                  </label>
                  <button className="secondary-button" type="submit">
                    <Plus size={17} aria-hidden="true" />
                    Add profession
                  </button>
                </form>
                <div className="job-type-list">
                  {profile.jobTypes.map((jobType) => (
                    <article className="job-type-row" key={jobType.id}>
                      <div>
                        <h3>{jobType.name}</h3>
                        <p>{profile.useJobNumberPrefixes ? `Job numbers start with ${jobType.jobNumberPrefix}` : 'Uses regular automatic numbering'}</p>
                      </div>
                      <div className="job-type-actions">
                        <span>{profile.useJobNumberPrefixes ? jobType.jobNumberPrefix : 'Auto'}</span>
                        <button className="text-button danger" type="button" onClick={() => removeJobType(jobType.id)}>
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                  {profile.jobTypes.length === 0 ? (
                    <div className="empty-inline">Select at least one profession or add a custom one.</div>
                  ) : null}
                </div>
              </section>

              <section className="panel team-setup-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Team setup</p>
                    <h2>Technicians and roles</h2>
                  </div>
                  <Users size={20} aria-hidden="true" />
                </div>
                <SetupGuide
                  title="Step-by-step setup guide"
                  intro="Add the people who need access and give technicians only the access they need for their work."
                  prepare="Each person's name, email, phone, role, and a secure access password or invitation plan."
                  steps={[
                    'Choose the default role for the next person: technician, dispatcher, or manager.',
                    "Click Add technician and enter the person's contact details.",
                    'Create or generate access credentials, then send them through a secure channel.',
                    'Edit the person later to update the role, phone, photo, or status.',
                    'Check the plan counter before adding more people; limits are enforced by the selected plan.',
                  ]}
                  complete="Every team member has the correct role, can sign in, and sees only the company work assigned to them."
                />
                <div className="team-setup-grid">
                  <MiniStat icon={<Users size={17} />} label="Technicians" value={`${profile.technicians.length}/${technicianLimit}`} />
                  <MiniStat icon={<UserPlus size={17} />} label="Plan limit" value={selectedPlan.name} />
                  <MiniStat icon={<ShieldCheck size={17} />} label="Owner" value="1" />
                  <MiniStat icon={<ClipboardList size={17} />} label="Assigned jobs" value={profile.technicians.reduce((total, technician) => total + technician.assignedJobs, 0).toString()} />
                </div>
                <div className="technician-toolbar">
                  <label>
                    Default role
                    <select value={technicianForm.role} onChange={(event) => setTechnicianForm({ ...technicianForm, role: event.target.value as CompanyTechnicianRole })}>
                      <option value="technician">Technician</option>
                      <option value="dispatcher">Dispatcher</option>
                      <option value="manager">Manager</option>
                    </select>
                  </label>
                  <button className="primary-button compact" type="button" onClick={openNewTechnicianModal} disabled={technicianLimitReached}>
                    <UserPlus size={17} aria-hidden="true" />
                    Add technician
                  </button>
                </div>
                {technicianLimitReached ? (
                  <p className="access-status">
                    {selectedPlan.name} plan allows up to {technicianLimit} technicians. Upgrade the plan before adding more.
                  </p>
                ) : null}
                <div className="technician-list compact">
                  {profile.technicians.map((technician) => (
                    <article className="technician-row" key={technician.id}>
                      <div className="technician-summary">
                        <div className="technician-avatar">
                          {technician.photoUrl ? <img src={technician.photoUrl} alt="" /> : technician.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                        <h3>{technician.name}</h3>
                        <p>{technician.email || 'No email'} - {technician.phone || 'No phone'}</p>
                        </div>
                      </div>
                      <span className={`technician-status ${technician.status}`}>{technician.status === 'disabled' ? 'Disabled' : technician.status}</span>
                      <span>{technician.role}</span>
                      <strong>{technician.assignedJobs} jobs</strong>
                      <button className="secondary-button compact" type="button" onClick={() => openEditTechnicianModal(technician)}>
                        Edit
                      </button>
                    </article>
                  ))}
                  {profile.technicians.length === 0 ? (
                    <div className="empty-inline">No technicians added yet.</div>
                  ) : null}
                </div>
              </section>
            </div>
          </section>
          {technicianEditorId !== '' ? (
            <div className="email-message-modal-backdrop" role="presentation" onClick={closeTechnicianModal}>
              <section className="email-message-modal technician-modal" role="dialog" aria-modal="true" aria-label="Technician details" onClick={(event) => event.stopPropagation()}>
                <div className="email-message-detail-header">
                  <div>
                    <p className="eyebrow">Team member</p>
                    <h2>{technicianEditorId ? 'Edit technician' : 'Add technician'}</h2>
                  </div>
                  <button className="secondary-button compact" type="button" onClick={closeTechnicianModal}>
                    Close
                  </button>
                </div>

                <form className="technician-modal-form" onSubmit={saveTechnicianDraft}>
                  <div className="technician-photo-editor">
                    <div className="technician-photo-preview">
                      {technicianDraft.photoUrl ? <img src={technicianDraft.photoUrl} alt="" /> : technicianDraft.name.slice(0, 2).toUpperCase() || 'T'}
                    </div>
                    <label className="secondary-button compact">
                      Upload photo
                      <input type="file" accept="image/*" onChange={handleTechnicianPhotoUpload} hidden />
                    </label>
                  </div>

                  <div className="technician-modal-fields">
                    <label>
                      Name
                      <input value={technicianDraft.name} onChange={(event) => setTechnicianDraft({ ...technicianDraft, name: event.target.value })} placeholder="Technician name" />
                    </label>
                    <label>
                      Email
                      <input type="email" value={technicianDraft.email} onChange={(event) => setTechnicianDraft({ ...technicianDraft, email: event.target.value })} placeholder="tech@company.com" />
                    </label>
                    <label>
                      Phone
                      <input value={technicianDraft.phone} onChange={(event) => setTechnicianDraft({ ...technicianDraft, phone: event.target.value })} placeholder="(555) 000-0000" />
                    </label>
                    <label>
                      Role
                      <select value={technicianDraft.role} onChange={(event) => {
                        const role = event.target.value as CompanyTechnicianRole;
                        setTechnicianDraft({ ...technicianDraft, role, pageAccess: defaultCompanyUserPageAccess(role) });
                      }}>
                        <option value="technician">Technician</option>
                        <option value="dispatcher">Dispatcher</option>
                        <option value="manager">Manager</option>
                      </select>
                    </label>
                    <label>
                      Access
                      <select value={technicianDraft.status} onChange={(event) => setTechnicianDraft({ ...technicianDraft, status: event.target.value as CompanyTechnician['status'] })}>
                        <option value="active">Active</option>
                        <option value="invited">Invited</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </label>
                    <label>
                      Password
                      <div className="password-field-row">
                        <input
                          type="text"
                          value={technicianDraft.accessPassword}
                          onChange={(event) => setTechnicianDraft({ ...technicianDraft, accessPassword: event.target.value })}
                          placeholder="Set or generate password"
                          autoComplete="off"
                        />
                        <button className="secondary-button compact" type="button" onClick={generateTechnicianDraftPassword}>
                          Generate
                        </button>
                      </div>
                    </label>
                  </div>

                  <section className="technician-page-access" aria-labelledby="technician-page-access-title">
                    <div className="technician-page-access-heading">
                      <div>
                        <p className="eyebrow">Portal permissions</p>
                        <h3 id="technician-page-access-title">Pages this person can use</h3>
                        <p>Full access can edit. Read only can view. Hidden removes the page from navigation and direct links.</p>
                      </div>
                      <ShieldCheck size={20} aria-hidden="true" />
                    </div>
                    <div className="technician-page-access-grid">
                      {companyUserPageAccessDefinitions.map(({ page, label, detail }) => {
                        const ownerOnly = page === 'onboarding';
                        const level = ownerOnly ? 'off' : technicianDraft.pageAccess?.[page] ?? 'off';
                        return (
                          <label className="technician-page-access-row" key={page}>
                            <span>
                              <strong>{label}</strong>
                              <small>{detail}</small>
                            </span>
                            {ownerOnly ? (
                              <em>Owner only</em>
                            ) : (
                              <select
                                value={level}
                                onChange={(event) => setTechnicianDraft({
                                  ...technicianDraft,
                                  pageAccess: { ...technicianDraft.pageAccess, [page]: event.target.value as 'full' | 'readonly' | 'off' },
                                })}
                              >
                                <option value="full">Full access</option>
                                <option value="readonly">Read only</option>
                                <option value="off">Hidden</option>
                              </select>
                            )}
                          </label>
                        );
                      })}
                    </div>
                    {technicianDraft.role === 'technician' ? (
                      <p className="access-status">Technicians use the mobile app. Desktop portal access is disabled for this role.</p>
                    ) : null}
                  </section>

                  {technicianEditorId ? (
                    <div className="access-actions technician-modal-actions">
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => {
                          const technicianId = persistTechnicianDraft();
                          if (technicianId) onSendTechnicianAccess(technicianId, 'create', technicianDraft.accessPassword);
                        }}
                      >
                        Create access
                      </button>
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => {
                          const technicianId = persistTechnicianDraft();
                          if (technicianId) onSendTechnicianAccess(technicianId, 'reset', technicianDraft.accessPassword);
                        }}
                      >
                        Reset password
                      </button>
                      {technicianAccessStatusById[technicianEditorId] ? (
                        <p className="access-status">{technicianAccessStatusById[technicianEditorId]}</p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="email-message-modal-actions">
                    <button className="secondary-button" type="button" onClick={closeTechnicianModal}>
                      Cancel
                    </button>
                    <button className="primary-button" type="submit">
                      Save technician
                    </button>
                  </div>
                </form>
              </section>
            </div>
          ) : null}
        </>);
}
