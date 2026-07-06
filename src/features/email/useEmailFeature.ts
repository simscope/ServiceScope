import { useRef, useState } from 'react';
import type {
  EmailCompose,
  EmailComposeAttachment,
  EmailConnection,
  EmailFolder,
  EmailMessage,
  EmailTemplate,
} from '../../appTypes';

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
  };
}
