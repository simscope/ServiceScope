import type { FormEvent } from 'react';
import { MailPlus } from 'lucide-react';
import type { EmailCompose, EmailConnection, EmailFolder, EmailMessage, EmailTemplate } from '../../appTypes';
import type { ServiceJob } from '../../types';

export function EmailPage({
  emailConnection,
  emailMessages,
  emailTemplates,
  emailProviderLabels,
  onOpenOnboarding,
  emailFolder,
  onEmailFolderChange,
  emailSearch,
  onEmailSearchChange,
  visibleEmailMessages,
  onApplyEmailTemplate,
  jobMap,
  onEmailComposeChange,
  emailCompose,
  allJobsRows,
  onSendEmailDraft,
}: {
  emailConnection: EmailConnection | null;
  emailMessages: EmailMessage[];
  emailTemplates: EmailTemplate[];
  emailProviderLabels: Record<EmailConnection['provider'], string>;
  onOpenOnboarding: () => void;
  emailFolder: EmailFolder;
  onEmailFolderChange: (folder: EmailFolder) => void;
  emailSearch: string;
  onEmailSearchChange: (value: string) => void;
  visibleEmailMessages: EmailMessage[];
  onApplyEmailTemplate: (template: EmailTemplate) => void;
  jobMap: Map<string, ServiceJob>;
  onEmailComposeChange: (compose: EmailCompose) => void;
  emailCompose: EmailCompose;
  allJobsRows: ServiceJob[];
  onSendEmailDraft: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="email-page">
      <div className="email-header">
        <div>
          <p className="eyebrow">Company mailbox</p>
          <h1>Email</h1>
        </div>
        <div className="email-summary">
          <span>
            <strong>{emailConnection?.status === 'connected' ? 'On' : emailConnection ? 'Setup' : 'Off'}</strong>
            Connection
          </span>
          <span>
            <strong>{emailMessages.filter((message) => message.unread).length}</strong>
            Unread
          </span>
          <span>
            <strong>{emailTemplates.length}</strong>
            Templates
          </span>
        </div>
      </div>

      <section className="email-connect-panel email-status-panel">
        <div>
          <p className="eyebrow">Mailbox status</p>
          <h2>{emailConnection ? emailConnection.address : 'No mailbox connected'}</h2>
          <p>
            {emailConnection
              ? emailConnection.status === 'connected'
                ? `${emailProviderLabels[emailConnection.provider]} connected. Last sync: ${emailConnection.lastSync}.`
                : `${emailProviderLabels[emailConnection.provider]} setup exists, but OAuth/backend is still required before sync/send.`
              : 'Connect the company mailbox in Company onboarding before sending emails.'}
          </p>
        </div>
        <button className="secondary-button compact" type="button" onClick={onOpenOnboarding}>
          Open onboarding
        </button>
      </section>

      <div className="email-layout">
        <aside className="email-sidebar">
          <div className="email-folder-list">
            {(['inbox', 'sent', 'templates'] as EmailFolder[]).map((folder) => (
              <button className={emailFolder === folder ? 'active' : ''} type="button" onClick={() => onEmailFolderChange(folder)} key={folder}>
                {folder}
              </button>
            ))}
          </div>
          <div className="email-connection-card">
            <strong>Mailbox permissions</strong>
            <span>Read messages</span>
            <span>Send messages</span>
            <span>Attach job context</span>
            <span>Sync by tenant only</span>
          </div>
        </aside>

        <section className="email-workspace">
          <div className="email-toolbar">
            <input value={emailSearch} onChange={(event) => onEmailSearchChange(event.target.value)} placeholder="Search sender, subject, job, client" />
            <button className="secondary-button compact" type="button" onClick={() => onEmailSearchChange('')}>
              Reset
            </button>
          </div>

          {emailFolder === 'templates' ? (
            <div className="email-template-grid">
              {emailTemplates.map((template) => (
                <article className="email-template-card" key={template.id}>
                  <h3>{template.name}</h3>
                  <strong>{template.subject}</strong>
                  <p>{template.body}</p>
                  <button className="secondary-button compact" type="button" onClick={() => onApplyEmailTemplate(template)}>
                    Use template
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="email-message-list">
              {visibleEmailMessages.map((message) => {
                const job = jobMap.get(message.jobNumber);

                return (
                  <article className={message.unread ? 'email-message-row unread' : 'email-message-row'} key={message.id}>
                    <div>
                      <div className="email-message-meta">
                        <strong>{emailFolder === 'inbox' ? message.from : message.to}</strong>
                        <span>{message.receivedAt}</span>
                      </div>
                      <h3>{message.subject}</h3>
                      <p>{message.preview}</p>
                      {job ? <span className="email-job-chip">#{job.jobNumber} - {job.organization}</span> : null}
                    </div>
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => {
                        onEmailComposeChange({
                          to: emailFolder === 'inbox' ? message.from : message.to,
                          subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
                          body: '',
                          jobNumber: message.jobNumber,
                        });
                      }}
                    >
                      Reply
                    </button>
                  </article>
                );
              })}
              {!visibleEmailMessages.length ? (
                <div className="empty-state compact-empty">
                  <MailPlus size={24} aria-hidden="true" />
                  <h3>No messages</h3>
                  <p>Connect a mailbox or change the search filter.</p>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <form className="email-compose-panel" onSubmit={onSendEmailDraft}>
          <div>
            <p className="eyebrow">Compose</p>
            <h2>New email</h2>
          </div>
          <label>
            To
            <input type="email" value={emailCompose.to} onChange={(event) => onEmailComposeChange({ ...emailCompose, to: event.target.value })} placeholder="client@example.com" />
          </label>
          <label>
            Related job
            <select value={emailCompose.jobNumber} onChange={(event) => onEmailComposeChange({ ...emailCompose, jobNumber: event.target.value })}>
              <option value="">No job</option>
              {allJobsRows.map((job) => (
                <option value={job.jobNumber} key={job.jobNumber}>
                  #{job.jobNumber} - {job.organization}
                </option>
              ))}
            </select>
          </label>
          <label>
            Subject
            <input value={emailCompose.subject} onChange={(event) => onEmailComposeChange({ ...emailCompose, subject: event.target.value })} placeholder="Subject" />
          </label>
          <label>
            Message
            <textarea value={emailCompose.body} onChange={(event) => onEmailComposeChange({ ...emailCompose, body: event.target.value })} placeholder="Write a message to the client." />
          </label>
          <button className="primary-button" type="submit" disabled={emailConnection?.status !== 'connected'}>
            <MailPlus size={16} aria-hidden="true" />
            Send email
          </button>
          {emailConnection?.status !== 'connected' ? <p className="email-compose-note">Email sending requires the backend OAuth/SMTP integration to be connected first.</p> : null}
        </form>
      </div>
    </section>
  );
}
