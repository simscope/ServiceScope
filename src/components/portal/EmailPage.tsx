import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { MailPlus } from 'lucide-react';
import type { EmailCompose, EmailComposeAttachment, EmailConnection, EmailFolder, EmailMessage, EmailTemplate } from '../../appTypes';
import type { ServiceJob } from '../../types';
import { loadMailboxMessageDetail } from '../../services/mailboxMessages';

export function EmailPage({
  emailConnection,
  emailMessages,
  emailTemplates,
  emailProviderLabels,
  onOpenOnboarding,
  onStartMailboxConnection,
  onLoadMoreMailbox,
  mailboxSyncing,
  mailboxConnectStatus,
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
  companySignature,
  companyPaymentBlock,
  composeRequestId,
  composeAttachmentRequest,
  onSendEmailDraft,
}: {
  emailConnection: EmailConnection | null;
  emailMessages: EmailMessage[];
  emailTemplates: EmailTemplate[];
  emailProviderLabels: Record<EmailConnection['provider'], string>;
  onOpenOnboarding: () => void;
  onStartMailboxConnection: () => void;
  onLoadMoreMailbox: () => void;
  mailboxSyncing: boolean;
  mailboxConnectStatus: string;
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
  companySignature: string;
  companyPaymentBlock: string;
  composeRequestId: number;
  composeAttachmentRequest: EmailComposeAttachment[];
  onSendEmailDraft: (attachments: EmailComposeAttachment[]) => Promise<void> | void;
}) {
  const [openedMessageId, setOpenedMessageId] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState<EmailComposeAttachment[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [loadingMessageId, setLoadingMessageId] = useState('');
  const [messageDetailsById, setMessageDetailsById] = useState<Record<string, Pick<EmailMessage, 'body' | 'bodyHtml' | 'attachments'>>>({});
  const openedMessageBase = useMemo(
    () => visibleEmailMessages.find((message) => message.id === openedMessageId) ?? null,
    [openedMessageId, visibleEmailMessages],
  );
  const openedMessage = useMemo(() => {
    if (!openedMessageBase) return null;
    const detail = messageDetailsById[openedMessageBase.id];
    return detail ? { ...openedMessageBase, ...detail } : openedMessageBase;
  }, [messageDetailsById, openedMessageBase]);
  const openedMessageDocument = useMemo(() => {
    if (!openedMessage?.bodyHtml) return '';

    return `<!doctype html><html><head><base target="_blank"><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif;line-height:1.45;}img{max-width:100%;height:auto;}table{max-width:100%;}a{color:#0b57d0;}</style></head><body>${openedMessage.bodyHtml}</body></html>`;
  }, [openedMessage]);

  useEffect(() => {
    if (!openedMessageBase || messageDetailsById[openedMessageBase.id] || loadingMessageId === openedMessageBase.id) return;

    let cancelled = false;
    setLoadingMessageId(openedMessageBase.id);
    loadMailboxMessageDetail(openedMessageBase.id)
      .then((detail) => {
        if (cancelled) return;
        setMessageDetailsById((details) => ({ ...details, [openedMessageBase.id]: detail }));
      })
      .catch(() => {
        if (cancelled) return;
        setMessageDetailsById((details) => ({
          ...details,
          [openedMessageBase.id]: {
            body: openedMessageBase.body,
            bodyHtml: openedMessageBase.bodyHtml,
            attachments: openedMessageBase.attachments,
          },
        }));
      })
      .finally(() => {
        if (!cancelled) setLoadingMessageId('');
      });

    return () => {
      cancelled = true;
    };
  }, [loadingMessageId, messageDetailsById, openedMessageBase]);

  useEffect(() => {
    if (!openedMessage && !composeOpen) return undefined;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenedMessageId('');
        setComposeOpen(false);
      }
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [composeOpen, openedMessage]);
  const mailboxReadyToConnect =
    Boolean(emailConnection?.address.trim()) &&
    (emailConnection?.provider === 'smtp' || emailConnection?.oauthClientSecretSaved);
  const connectionLabel = emailConnection?.status === 'connected' ? 'On' : mailboxReadyToConnect ? 'Ready' : emailConnection ? 'Setup' : 'Off';
  const connectionDescription = emailConnection
    ? emailConnection.status === 'connected'
      ? `${emailProviderLabels[emailConnection.provider]} connected. Last sync: ${emailConnection.lastSync}.`
      : mailboxReadyToConnect
        ? `${emailProviderLabels[emailConnection.provider]} credentials are saved. Connect this mailbox to enable sync and sending.`
        : `${emailProviderLabels[emailConnection.provider]} needs a mailbox email and saved credentials before connection.`
    : 'Connect the company mailbox in Company onboarding before sending emails.';

  const openCompose = (nextCompose?: EmailCompose) => {
    if (nextCompose) {
      onEmailComposeChange({
        ...nextCompose,
        signatureText: companySignature,
        paymentBlockText: companyPaymentBlock,
      });
    } else {
      onEmailComposeChange({
        ...emailCompose,
        signatureText: companySignature,
        paymentBlockText: companyPaymentBlock,
      });
    }
    setComposeOpen(true);
  };

  const closeCompose = () => {
    clearComposeAttachments();
    setComposeOpen(false);
  };

  const clearComposeAttachments = () => {
    setComposeAttachments([]);
    setFileInputKey((key) => key + 1);
  };

  useEffect(() => {
    if (!composeRequestId) return;
    setComposeAttachments(composeAttachmentRequest);
    setFileInputKey((key) => key + 1);
    openCompose();
  }, [composeRequestId]);

  const readAttachmentFile = (file: File) =>
    new Promise<EmailComposeAttachment>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        resolve({
          id: `${file.name}-${file.lastModified}-${file.size}`,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          contentBase64: result.includes(',') ? result.split(',').pop() ?? '' : result,
        });
      };
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });

  const handleComposeFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    const nextAttachments = await Promise.all(files.map(readAttachmentFile));
    setComposeAttachments((current) => [...current, ...nextAttachments]);
    setFileInputKey((key) => key + 1);
  };

  const removeComposeAttachment = (id: string) => {
    setComposeAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const submitCompose = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    try {
      await onSendEmailDraft(composeAttachments);
      clearComposeAttachments();
      closeCompose();
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="email-page">
      <div className="email-header">
        <div>
          <p className="eyebrow">Company mailbox</p>
          <h1>Email</h1>
        </div>
        <div className="email-summary">
          <span>
            <strong>{connectionLabel}</strong>
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
          <p>{connectionDescription}</p>
          {mailboxConnectStatus ? <p className="access-status">{mailboxConnectStatus}</p> : null}
        </div>
        <div className="email-status-actions">
          {emailConnection?.status === 'connected' ? (
            <button className="secondary-button compact" type="button" onClick={onLoadMoreMailbox} disabled={mailboxSyncing}>
              {mailboxSyncing ? 'Loading emails...' : 'Load more emails'}
            </button>
          ) : null}
          {emailConnection?.status !== 'connected' && mailboxReadyToConnect ? (
            <button className="primary-button compact" type="button" onClick={onStartMailboxConnection}>
              Connect mailbox
            </button>
          ) : null}
          {emailConnection?.status !== 'connected' ? (
            <button className="secondary-button compact" type="button" onClick={onOpenOnboarding}>
              Open onboarding
            </button>
          ) : null}
        </div>
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
            <button className="primary-button compact" type="button" onClick={() => openCompose()}>
              New email
            </button>
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
                  <article
                    className={message.unread ? 'email-message-row unread' : 'email-message-row'}
                    key={message.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenedMessageId(message.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setOpenedMessageId(message.id);
                      }
                    }}
                  >
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
                      onClick={(event) => {
                        event.stopPropagation();
                        openCompose({
                          to: emailFolder === 'inbox' ? message.from : message.to,
                          subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
                          body: '',
                          jobNumber: message.jobNumber,
                          includeSignature: true,
                          includePaymentBlock: false,
                          signatureText: companySignature,
                          paymentBlockText: companyPaymentBlock,
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

        <aside className="email-compose-panel">
          <div>
            <p className="eyebrow">Compose</p>
            <h2>New email</h2>
          </div>
          <button className="primary-button" type="button" onClick={() => openCompose()} disabled={emailConnection?.status !== 'connected'}>
            <MailPlus size={16} aria-hidden="true" />
            Open composer
          </button>
          {emailConnection?.status !== 'connected' ? <p className="email-compose-note">Connect the mailbox first to enable sending.</p> : null}
          {emailConnection?.status === 'connected' ? <p className="email-compose-note neutral">Replies, forwarding, signature, payment block, and attachments open in a modal window.</p> : null}
        </aside>
      </div>
      {openedMessage ? (
        <div className="email-message-modal-backdrop" role="presentation" onClick={() => setOpenedMessageId('')}>
          <section className="email-message-modal" role="dialog" aria-modal="true" aria-label="Opened email" onClick={(event) => event.stopPropagation()}>
            <div className="email-message-detail-header">
              <div>
                <h2>{openedMessage.subject}</h2>
              </div>
              <div className="email-message-header-actions">
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => {
                    openCompose({
                      to: emailFolder === 'inbox' ? openedMessage.from : openedMessage.to,
                      subject: openedMessage.subject.startsWith('Re:') ? openedMessage.subject : `Re: ${openedMessage.subject}`,
                      body: '',
                      jobNumber: openedMessage.jobNumber,
                      includeSignature: true,
                      includePaymentBlock: false,
                      signatureText: companySignature,
                      paymentBlockText: companyPaymentBlock,
                    });
                    setOpenedMessageId('');
                  }}
                >
                  Reply
                </button>
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => {
                    openCompose({
                      to: '',
                      subject: openedMessage.subject.startsWith('Fwd:') ? openedMessage.subject : `Fwd: ${openedMessage.subject}`,
                      body: `\n\n---------- Forwarded message ---------\nFrom: ${openedMessage.from}\nDate: ${openedMessage.receivedAt}\nSubject: ${openedMessage.subject}\nTo: ${openedMessage.to}\n\n${openedMessage.body || openedMessage.preview}`,
                      jobNumber: openedMessage.jobNumber,
                      includeSignature: true,
                      includePaymentBlock: false,
                      signatureText: companySignature,
                      paymentBlockText: companyPaymentBlock,
                    });
                    setOpenedMessageId('');
                  }}
                >
                  Forward
                </button>
                <button className="secondary-button compact" type="button" onClick={() => setOpenedMessageId('')}>
                  Close
                </button>
              </div>
            </div>
            <div className="email-message-detail-meta">
              <div><strong>From:</strong> {openedMessage.from || 'Unknown'}</div>
              <div><strong>To:</strong> {openedMessage.to || 'Unknown'}</div>
              <div><strong>Date:</strong> {openedMessage.receivedAt || 'Unknown'}</div>
            </div>
            {openedMessage.attachments.length ? (
              <div className="email-attachment-panel">
                <strong>Attachments</strong>
                <div className="email-attachment-grid">
                  {openedMessage.attachments.map((attachment) => (
                    <a className="email-attachment-item" href={attachment.dataUrl} download={attachment.fileName} target="_blank" rel="noreferrer" key={attachment.id}>
                      {attachment.mimeType.startsWith('image/') ? (
                        <img src={attachment.dataUrl} alt={attachment.fileName} />
                      ) : (
                        <span>{attachment.fileName.split('.').pop()?.toUpperCase() || 'FILE'}</span>
                      )}
                      <small>{attachment.fileName}</small>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
            {openedMessageDocument ? (
              <iframe className="email-message-html-frame" title={openedMessage.subject} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={openedMessageDocument} />
            ) : (
              <div className="email-message-body">{loadingMessageId === openedMessage.id ? 'Loading email body from mailbox...' : openedMessage.body || openedMessage.preview || 'No message body available.'}</div>
            )}
          </section>
        </div>
      ) : null}
      {composeOpen ? (
        <div className="email-message-modal-backdrop" role="presentation" onClick={closeCompose}>
          <form className="email-compose-modal" role="dialog" aria-modal="true" aria-label="New email" onSubmit={submitCompose} onClick={(event) => event.stopPropagation()}>
            <div className="email-message-detail-header">
              <h2>New email</h2>
              <button className="secondary-button compact" type="button" onClick={closeCompose}>
                Close
              </button>
            </div>
            <label>
              From
              <input value={emailConnection?.address ?? ''} readOnly />
            </label>
            <label>
              To, comma separated
              <input value={emailCompose.to} onChange={(event) => onEmailComposeChange({ ...emailCompose, to: event.target.value })} placeholder="client@example.com" />
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
              Text
              <textarea value={emailCompose.body} onChange={(event) => onEmailComposeChange({ ...emailCompose, body: event.target.value })} placeholder="Write a message to the client." />
            </label>
            <div className="email-compose-preview-grid">
              <div>
                <label className="email-compose-option-toggle">
                  <input
                    type="checkbox"
                    checked={emailCompose.includeSignature}
                    onChange={(event) => onEmailComposeChange({
                      ...emailCompose,
                      includeSignature: event.target.checked,
                      signatureText: event.target.checked ? (emailCompose.signatureText || companySignature) : emailCompose.signatureText,
                    })}
                  />
                  Add company signature
                </label>
                <label>
                  Signature block
                  <textarea
                    value={emailCompose.signatureText || companySignature}
                    onChange={(event) => onEmailComposeChange({ ...emailCompose, signatureText: event.target.value })}
                    disabled={!emailCompose.includeSignature}
                    placeholder="Company signature"
                  />
                </label>
              </div>
              <div>
                <label className="email-compose-option-toggle">
                  <input
                    type="checkbox"
                    checked={emailCompose.includePaymentBlock}
                    onChange={(event) => onEmailComposeChange({
                      ...emailCompose,
                      includePaymentBlock: event.target.checked,
                      paymentBlockText: event.target.checked ? (emailCompose.paymentBlockText || companyPaymentBlock) : emailCompose.paymentBlockText,
                    })}
                  />
                  Add payment options
                </label>
                <label>
                  Payment block
                  <textarea
                    value={emailCompose.paymentBlockText || companyPaymentBlock}
                    onChange={(event) => onEmailComposeChange({ ...emailCompose, paymentBlockText: event.target.value })}
                    disabled={!emailCompose.includePaymentBlock}
                    placeholder="Payment options"
                  />
                </label>
              </div>
            </div>
            <div className="email-compose-attachments">
              <strong>Attachments</strong>
              <label className="email-file-picker">
                <span>Choose files</span>
                <input key={fileInputKey} type="file" multiple onChange={handleComposeFiles} />
              </label>
              {composeAttachments.length ? (
                <div className="email-compose-attachment-list">
                  {composeAttachments.map((attachment) => (
                    <span key={attachment.id}>
                      {attachment.fileName}
                      <button type="button" onClick={() => removeComposeAttachment(attachment.id)}>
                        Remove
                      </button>
                    </span>
                  ))}
                </div>
              ) : <p>No files selected.</p>}
            </div>
            <p className="email-compose-note neutral">Large files can fail at the Edge Function body limit; keep one email under 8 MB total attachments.</p>
            <div className="email-compose-actions">
              <button className="primary-button" type="submit" disabled={emailConnection?.status !== 'connected' || sending}>
                <MailPlus size={16} aria-hidden="true" />
                {sending ? 'Sending...' : 'Send email'}
              </button>
              <button className="secondary-button" type="button" onClick={closeCompose}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
