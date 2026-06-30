const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const emailPagePath = path.join(root, 'src/components/portal/EmailPage.tsx');
let emailPage = fs.readFileSync(emailPagePath, 'utf8');

if (!emailPage.includes("../../services/mailboxMessages")) {
  emailPage = emailPage.replace(
    "import type { ServiceJob } from '../../types';",
    "import type { ServiceJob } from '../../types';\nimport { loadMailboxMessageDetail } from '../../services/mailboxMessages';",
  );
}

if (!emailPage.includes('messageDetailsById')) {
  emailPage = emailPage.replace(
    `  const [sending, setSending] = useState(false);
  const openedMessage = useMemo(
    () => visibleEmailMessages.find((message) => message.id === openedMessageId) ?? null,
    [openedMessageId, visibleEmailMessages],
  );
  const openedMessageDocument = useMemo(() => {
    if (!openedMessage?.bodyHtml) return '';

    return \`<!doctype html><html><head><base target="_blank"><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif;line-height:1.45;}img{max-width:100%;height:auto;}table{max-width:100%;}a{color:#0b57d0;}</style></head><body>\${openedMessage.bodyHtml}</body></html>\`;
  }, [openedMessage]);`,
    `  const [sending, setSending] = useState(false);
  const [messageDetailsById, setMessageDetailsById] = useState<Record<string, Pick<EmailMessage, 'body' | 'bodyHtml' | 'attachments'>>>({});
  const [loadingMessageId, setLoadingMessageId] = useState('');
  const [messageDetailStatus, setMessageDetailStatus] = useState('');
  const openedBaseMessage = useMemo(
    () => visibleEmailMessages.find((message) => message.id === openedMessageId) ?? null,
    [openedMessageId, visibleEmailMessages],
  );
  const openedMessage = useMemo(() => {
    if (!openedBaseMessage) return null;
    const details = messageDetailsById[openedBaseMessage.id];
    if (!details) return openedBaseMessage;
    return {
      ...openedBaseMessage,
      body: details.body || openedBaseMessage.body,
      bodyHtml: details.bodyHtml || openedBaseMessage.bodyHtml,
      attachments: details.attachments.length ? details.attachments : openedBaseMessage.attachments,
    };
  }, [openedBaseMessage, messageDetailsById]);
  const openedMessageDocument = useMemo(() => {
    if (!openedMessage?.bodyHtml) return '';

    return \`<!doctype html><html><head><base target="_blank"><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,sans-serif;line-height:1.45;}img{max-width:100%;height:auto;}table{max-width:100%;}a{color:#0b57d0;}</style></head><body>\${openedMessage.bodyHtml}</body></html>\`;
  }, [openedMessage]);`,
  );
}

if (!emailPage.includes('loadMailboxMessageDetail(openedBaseMessage.id)')) {
  emailPage = emailPage.replace(
    `  useEffect(() => {
    if (!openedMessage && !composeOpen) return undefined;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenedMessageId('');
        setComposeOpen(false);
      }
    }

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [composeOpen, openedMessage]);`,
    `  useEffect(() => {
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

  useEffect(() => {
    if (!openedBaseMessage || messageDetailsById[openedBaseMessage.id]) return undefined;

    let cancelled = false;
    setLoadingMessageId(openedBaseMessage.id);
    setMessageDetailStatus('Loading email body from mailbox...');

    loadMailboxMessageDetail(openedBaseMessage.id)
      .then((details) => {
        if (cancelled) return;
        setMessageDetailsById((current) => ({ ...current, [openedBaseMessage.id]: details }));
        setMessageDetailStatus('');
      })
      .catch((error) => {
        if (cancelled) return;
        setMessageDetailStatus(error instanceof Error ? error.message : 'Email body could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoadingMessageId('');
      });

    return () => {
      cancelled = true;
    };
  }, [openedBaseMessage, messageDetailsById]);`,
  );
}

if (!emailPage.includes('{messageDetailStatus ? <p className="access-status">{messageDetailStatus}</p> : null}')) {
  emailPage = emailPage.replace(
    `              <div><strong>Date:</strong> {openedMessage.receivedAt || 'Unknown'}</div>
            </div>`,
    `              <div><strong>Date:</strong> {openedMessage.receivedAt || 'Unknown'}</div>
            </div>
            {messageDetailStatus ? <p className="access-status">{messageDetailStatus}</p> : null}`,
  );
}

if (!emailPage.includes("return attachment.dataUrl ? (")) {
  emailPage = emailPage.replace(
    `                  {openedMessage.attachments.map((attachment) => (
                    <a className="email-attachment-item" href={attachment.dataUrl} download={attachment.fileName} target="_blank" rel="noreferrer" key={attachment.id}>
                      {attachment.mimeType.startsWith('image/') ? (
                        <img src={attachment.dataUrl} alt={attachment.fileName} />
                      ) : (
                        <span>{attachment.fileName.split('.').pop()?.toUpperCase() || 'FILE'}</span>
                      )}
                      <small>{attachment.fileName}</small>
                    </a>
                  ))}`,
    `                  {openedMessage.attachments.map((attachment) => {
                    return attachment.dataUrl ? (
                      <a className="email-attachment-item" href={attachment.dataUrl} download={attachment.fileName} target="_blank" rel="noreferrer" key={attachment.id}>
                        {attachment.mimeType.startsWith('image/') ? (
                          <img src={attachment.dataUrl} alt={attachment.fileName} />
                        ) : (
                          <span>{attachment.fileName.split('.').pop()?.toUpperCase() || 'FILE'}</span>
                        )}
                        <small>{attachment.fileName}</small>
                      </a>
                    ) : (
                      <div className="email-attachment-item" key={attachment.id} title="Attachment stays in Gmail and loads only on demand">
                        <span>{attachment.fileName.split('.').pop()?.toUpperCase() || 'FILE'}</span>
                        <small>{attachment.fileName}</small>
                      </div>
                    );
                  })}`,
  );
}

emailPage = emailPage.replace(
  "{openedMessage.body || openedMessage.preview || 'No message body available.'}",
  "{loadingMessageId === openedMessage.id ? 'Loading email body from mailbox...' : openedMessage.body || openedMessage.preview || 'No message body available.'}",
);

fs.writeFileSync(emailPagePath, emailPage);
console.log('Mailbox page patched for on-demand email bodies.');
