import { useMemo, useRef, useState } from 'react';
import type {
  EmailCompose,
  EmailComposeAttachment,
  EmailConnection,
  EmailFolder,
  EmailMessage,
  EmailTemplate,
} from '../../appTypes';
import { loadMailboxMessages, syncMailboxMessages } from '../../services/mailboxMessages';

const emptyEmailCompose: EmailCompose = {
  to: '',
  subject: '',
  body: '',
  jobNumber: '',
  includeSignature: true,
  includePaymentBlock: false,
  signatureText: '',
  paymentBlockText: '',
};

export function useEmailFeature() {
  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(null);
  const [mailboxConnectStatus, setMailboxConnectStatus] = useState('');
  const [mailboxOAuthSecretDraft, setMailboxOAuthSecretDraft] = useState('');
  const [mailboxOAuthStatus, setMailboxOAuthStatus] = useState('');
  const [emailFolder, setEmailFolder] = useState<EmailFolder>('inbox');
  const [emailSearch, setEmailSearch] = useState('');
  const [emailMessages, setEmailMessages] = useState<EmailMessage[]>([]);
  const [mailboxSyncLimit, setMailboxSyncLimit] = useState(25);
  const [mailboxSyncing, setMailboxSyncing] = useState(false);
  const mailboxSyncingRef = useRef(false);
  const [emailCompose, setEmailCompose] = useState<EmailCompose>(emptyEmailCompose);
  const [emailComposeRequestId, setEmailComposeRequestId] = useState(0);
  const [emailComposeAttachments, setEmailComposeAttachments] = useState<EmailComposeAttachment[]>([]);
  const unreadEmailCount = useMemo(() => emailMessages.filter((message) => message.unread).length, [emailMessages]);

  const applyEmailTemplate = (template: EmailTemplate) => {
    setEmailCompose((draft) => ({
      ...draft,
      subject: template.subject,
      body: template.body,
    }));
    setEmailFolder('inbox');
  };

  const resetEmailCompose = (signatureText: string, paymentBlockText: string) => {
    setEmailCompose({
      ...emptyEmailCompose,
      signatureText,
      paymentBlockText,
    });
  };

  const openEmailComposeDraft = (
    compose: EmailCompose,
    attachments: EmailComposeAttachment[],
    signatureText: string,
    paymentBlockText: string,
  ) => {
    setEmailCompose({
      ...compose,
      signatureText: compose.signatureText || signatureText,
      paymentBlockText: compose.paymentBlockText || paymentBlockText,
    });
    setEmailComposeAttachments(attachments);
    setEmailComposeRequestId((requestId) => requestId + 1);
  };

  const syncConnectedMailboxMessages = async (companyId: string, limit = mailboxSyncLimit) => {
    if (mailboxSyncingRef.current) {
      setMailboxConnectStatus('Mailbox sync is already running. Wait a moment.');
      return;
    }

    mailboxSyncingRef.current = true;
    setMailboxSyncing(true);

    try {
      const savedMessages = await loadMailboxMessages(companyId);
      setEmailMessages(savedMessages);
      setMailboxConnectStatus('Syncing mailbox...');

      const result = await syncMailboxMessages(companyId, limit);
      const syncedMessages = await loadMailboxMessages(companyId);
      setEmailMessages(syncedMessages);

      if (result.count) {
        setMailboxConnectStatus(`Synced ${result.count} messages (${result.inbox} inbox, ${result.sent} sent).`);
      } else {
        setMailboxConnectStatus('Mailbox synced. No messages found.');
      }
    } finally {
      mailboxSyncingRef.current = false;
      setMailboxSyncing(false);
    }
  };

  const loadMoreMailboxMessages = (companyId: string) => {
    if (!companyId || mailboxSyncingRef.current) return;
    const nextLimit = Math.min(100, mailboxSyncLimit + 25);
    setMailboxSyncLimit(nextLimit);
    syncConnectedMailboxMessages(companyId, nextLimit).catch((error) => {
      setMailboxConnectStatus(error instanceof Error ? error.message : 'Mailbox sync failed.');
    });
  };

  return {
    emailConnection,
    setEmailConnection,
    mailboxConnectStatus,
    setMailboxConnectStatus,
    mailboxOAuthSecretDraft,
    setMailboxOAuthSecretDraft,
    mailboxOAuthStatus,
    setMailboxOAuthStatus,
    emailFolder,
    setEmailFolder,
    emailSearch,
    setEmailSearch,
    emailMessages,
    setEmailMessages,
    unreadEmailCount,
    mailboxSyncLimit,
    setMailboxSyncLimit,
    mailboxSyncing,
    setMailboxSyncing,
    mailboxSyncingRef,
    emailCompose,
    setEmailCompose,
    emailComposeRequestId,
    emailComposeAttachments,
    applyEmailTemplate,
    resetEmailCompose,
    openEmailComposeDraft,
    syncConnectedMailboxMessages,
    loadMoreMailboxMessages,
  };
}
