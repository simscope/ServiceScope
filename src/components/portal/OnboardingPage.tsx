import type { ChangeEvent, FormEvent } from 'react';
import { Building2, ClipboardList, CreditCard, MailPlus, Plus, ShieldCheck, UserPlus, Users } from 'lucide-react';
import type { EmailConnection, EmailProvider } from '../../appTypes';
import { paymentMethodLabels } from '../../appLabels';
import { getPlan } from '../../services/billingCatalog';
import { money } from '../../utils/format';
import type {
  Company,
  CompanyOnboardingProfile,
  CompanyPaymentMethod,
  CompanyTechnicianRole,
  NewCompanyJobTypeForm,
  NewCompanyTechnicianForm,
} from '../../types';
import { MiniStat } from '../OwnerPages';

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
  generateAccessPassword,
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
  generateAccessPassword: () => string;
}) {
  const selectedPlan = getPlan(selectedCompany.plan);
  const subscriptionConnected = profile.subscriptionPaymentStatus === 'active' && profile.autoPayEnabled;
  const subscriptionStatusLabel =
    profile.subscriptionPaymentStatus === 'not_connected'
      ? 'Not connected'
      : profile.subscriptionPaymentStatus === 'pending'
        ? 'Pending verification'
        : profile.subscriptionPaymentStatus === 'active'
          ? 'Active'
          : 'Failed';

  function updateTechnician(technicianId: string, updates: Partial<CompanyOnboardingProfile['technicians'][number]>) {
    updateProfile({
      technicians: profile.technicians.map((technician) =>
        technician.id === technicianId ? { ...technician, ...updates } : technician,
      ),
    });
  }

  return (<section className="client-onboarding">
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

              <section className="panel workspace-mailbox-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Mailbox setup</p>
                    <h2>{emailConnection ? emailConnection.address : 'Configure company email'}</h2>
                  </div>
                  <MailPlus size={20} aria-hidden="true" />
                </div>
                <div className="mailbox-setup-content">
                  <div className="mailbox-step provider-step">
                    <div>
                      <strong>1. Provider</strong>
                      <p>Choose a provider. This only prepares the setup; real OAuth/SMTP backend is still required.</p>
                    </div>
                    <div className="email-provider-actions">
                      {(['google', 'microsoft', 'smtp'] as EmailProvider[]).map((provider) => (
                        <button className={emailConnection?.provider === provider ? 'provider-button active' : 'provider-button'} type="button" onClick={() => connectMailbox(provider)} key={provider}>
                          {emailConnection?.provider === provider ? `${emailProviderLabels[provider]} selected` : `Start ${emailProviderLabels[provider]} setup`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mailbox-step">
                    <div>
                      <strong>2. Mailbox and permissions</strong>
                      <p>{emailConnection ? `${emailProviderLabels[emailConnection.provider]} setup draft created. Last sync: ${emailConnection.lastSync}.` : 'Select a provider to configure address, permissions, sync, and sending identity.'}</p>
                    </div>
                    <div className="mailbox-permissions">
                      <span>Read company mailbox</span>
                      <span>Send as company</span>
                      <span>Attach messages to jobs</span>
                      <span>Tenant isolated tokens</span>
                    </div>
                    <div className="mailbox-settings-grid">
                      <label>
                        Mailbox address
                        <input value={emailConnection?.address ?? ''} onChange={(event) => updateMailbox({ address: event.target.value, replyTo: event.target.value })} placeholder="dispatch@company.com" disabled={!emailConnection} />
                      </label>
                      <label>
                        Connection status
                        <select value={emailConnection?.status ?? 'backend_required'} onChange={(event) => updateMailbox({ status: event.target.value as EmailConnection['status'] })} disabled={!emailConnection}>
                          <option value="backend_required">OAuth/backend required</option>
                          <option value="connected">Connected by backend</option>
                        </select>
                      </label>
                    </div>
                    <div className="mailbox-backend-warning">
                      This screen does not connect Gmail or Microsoft by itself. Production requires OAuth app setup, redirect URL, encrypted token storage, token refresh, Gmail/Graph API calls, webhook/sync jobs, and reconnect handling.
                    </div>
                  </div>

                  <div className="mailbox-step">
                    <div>
                      <strong>3. Sync rules</strong>
                      <p>Choose how messages are imported and linked to operations.</p>
                    </div>
                    <div className="mailbox-settings-grid">
                      <label>
                        Sync inbox from
                        <select value={emailConnection?.syncRange ?? '30'} onChange={(event) => updateMailbox({ syncRange: event.target.value as EmailConnection['syncRange'] })} disabled={!emailConnection}>
                          <option value="7">Last 7 days</option>
                          <option value="30">Last 30 days</option>
                          <option value="90">Last 90 days</option>
                        </select>
                      </label>
                      <label className="mailbox-check">
                        <input type="checkbox" checked={emailConnection?.autoLinkJobNumber ?? false} onChange={(event) => updateMailbox({ autoLinkJobNumber: event.target.checked })} disabled={!emailConnection} />
                        Auto-link by job number
                      </label>
                      <label className="mailbox-check">
                        <input type="checkbox" checked={emailConnection?.autoLinkClientEmail ?? false} onChange={(event) => updateMailbox({ autoLinkClientEmail: event.target.checked })} disabled={!emailConnection} />
                        Auto-link by client email
                      </label>
                      <label className="mailbox-check">
                        <input type="checkbox" checked={emailConnection?.createTaskFromUnread ?? false} onChange={(event) => updateMailbox({ createTaskFromUnread: event.target.checked })} disabled={!emailConnection} />
                        Create task from unread client email
                      </label>
                    </div>
                  </div>

                  <div className="mailbox-step">
                    <div>
                      <strong>4. Sending identity</strong>
                      <p>This is what customers see when the company sends email.</p>
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
                  </div>

                  {emailConnection?.provider === 'smtp' ? (
                    <div className="mailbox-step">
                      <div>
                        <strong>5. SMTP / IMAP fallback</strong>
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
                      <strong>Test connection</strong>
                      <p>Send a test email and verify inbox sync before launch.</p>
                    </div>
                    <button className="secondary-button compact" type="button" disabled={emailConnection?.status !== 'connected'}>
                      Test disabled until backend is connected
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
                    <strong>{profile.subscriptionCardLast4 ? `•••• ${profile.subscriptionCardLast4}` : 'No card on file'}</strong>
                    <small>
                      {profile.subscriptionCardExpMonth && profile.subscriptionCardExpYear
                        ? `Expires ${profile.subscriptionCardExpMonth}/${profile.subscriptionCardExpYear}`
                        : 'Expiration not added'}
                    </small>
                  </div>
                </div>

                <div className="subscription-payment-fields">
                  <label>
                    Card brand
                    <select value={profile.subscriptionCardBrand} onChange={(event) => updateProfile({ subscriptionCardBrand: event.target.value })}>
                      <option value="Visa">Visa</option>
                      <option value="Mastercard">Mastercard</option>
                      <option value="American Express">American Express</option>
                      <option value="Discover">Discover</option>
                    </select>
                  </label>
                  <label>
                    Card number
                    <input
                      inputMode="numeric"
                      maxLength={19}
                      defaultValue=""
                      onChange={(event) => {
                        const digits = event.target.value.replace(/\D/g, '').slice(0, 19);
                        updateProfile({ subscriptionCardLast4: digits.slice(-4) });
                      }}
                      placeholder="Card number"
                    />
                  </label>
                  <label>
                    Exp. month
                    <input
                      inputMode="numeric"
                      maxLength={2}
                      value={profile.subscriptionCardExpMonth}
                      onChange={(event) => updateProfile({ subscriptionCardExpMonth: event.target.value.replace(/\D/g, '').slice(0, 2) })}
                      placeholder="MM"
                    />
                  </label>
                  <label>
                    Exp. year
                    <input
                      inputMode="numeric"
                      maxLength={4}
                      value={profile.subscriptionCardExpYear}
                      onChange={(event) => updateProfile({ subscriptionCardExpYear: event.target.value.replace(/\D/g, '').slice(0, 4) })}
                      placeholder="YYYY"
                    />
                  </label>
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
                  <label className="checkbox-field prefix-toggle">
                    <input
                      type="checkbox"
                      checked={profile.autoPayEnabled}
                      onChange={(event) => updateProfile({ autoPayEnabled: event.target.checked })}
                    />
                    Enable automatic monthly charges
                  </label>
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
                      const selected = configuredProfessionNames.has(template.name.toLowerCase());

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
                <div className="team-setup-grid">
                  <MiniStat icon={<Users size={17} />} label="Technicians" value={profile.technicians.length.toString()} />
                  <MiniStat icon={<UserPlus size={17} />} label="Seats" value={selectedCompany.seats.toString()} />
                  <MiniStat icon={<ShieldCheck size={17} />} label="Owner" value="1" />
                  <MiniStat icon={<ClipboardList size={17} />} label="Assigned jobs" value={profile.technicians.reduce((total, technician) => total + technician.assignedJobs, 0).toString()} />
                </div>
                <div className="setup-fields">
                  <label>
                    Default technician role
                    <select value={technicianForm.role} onChange={(event) => setTechnicianForm({ ...technicianForm, role: event.target.value as CompanyTechnicianRole })}>
                      <option value="technician">Technician</option>
                      <option value="dispatcher">Dispatcher</option>
                      <option value="manager">Manager</option>
                    </select>
                  </label>
                </div>
                <form className="technician-form" onSubmit={handleTechnicianSubmit}>
                  <label>
                    Technician name
                    <input value={technicianForm.name} onChange={(event) => setTechnicianForm({ ...technicianForm, name: event.target.value })} placeholder="Alex Rivera" />
                  </label>
                  <label>
                    Email
                    <input type="email" value={technicianForm.email} onChange={(event) => setTechnicianForm({ ...technicianForm, email: event.target.value })} placeholder="tech@company.com" />
                  </label>
                  <label>
                    Phone
                    <input value={technicianForm.phone} onChange={(event) => setTechnicianForm({ ...technicianForm, phone: event.target.value })} placeholder="(555) 000-0000" />
                  </label>
                  <label>
                    Access password
                    <div className="password-field-row">
                      <input
                        type="text"
                        value={technicianForm.accessPassword}
                        onChange={(event) => setTechnicianForm({ ...technicianForm, accessPassword: event.target.value })}
                        placeholder="Set access password"
                      />
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => setTechnicianForm({ ...technicianForm, accessPassword: generateAccessPassword() })}
                      >
                        Generate
                      </button>
                    </div>
                  </label>
                  <button className="secondary-button" type="submit">
                    <UserPlus size={17} aria-hidden="true" />
                    Add technician
                  </button>
                </form>
                <div className="technician-list">
                  {profile.technicians.map((technician) => (
                    <article className="technician-row" key={technician.id}>
                      <div>
                        <h3>{technician.name}</h3>
                        <p>{technician.email || 'No email'} - {technician.phone || 'No phone'}</p>
                        <div className="technician-access-controls">
                          <label>
                            Access password
                            <div className="password-field-row">
                              <input
                                type="text"
                                value={technician.accessPassword}
                                onChange={(event) => updateTechnician(technician.id, { accessPassword: event.target.value })}
                                placeholder="Set access password"
                              />
                              <button
                                className="secondary-button compact"
                                type="button"
                                onClick={() => updateTechnician(technician.id, { accessPassword: generateAccessPassword() })}
                              >
                                Generate
                              </button>
                            </div>
                          </label>
                          <label>
                            Access
                            <select
                              value={technician.status}
                              onChange={(event) => updateTechnician(technician.id, { status: event.target.value as typeof technician.status })}
                            >
                              <option value="active">Active</option>
                              <option value="invited">Invited</option>
                              <option value="disabled">Disabled</option>
                            </select>
                          </label>
                        </div>
                      </div>
                      <span>{technician.status === 'disabled' ? 'Access disabled' : technician.role}</span>
                      <strong>{technician.assignedJobs} jobs</strong>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </section>  );
}
