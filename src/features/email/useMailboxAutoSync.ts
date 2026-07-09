import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { EmailConnection, EmailMessage } from '../../appTypes';

type MailboxAutoSyncInput = {
  emailConnection: EmailConnection | null;
  selectedCompanyId: string;
  setEmailMessages: Dispatch<SetStateAction<EmailMessage[]>>;
  syncConnectedMailboxMessages: (companyId: string) => Promise<unknown>;
  setMailboxConnectStatus: Dispatch<SetStateAction<string>>;
};

export function useMailboxAutoSync({
  emailConnection,
  selectedCompanyId,
  setEmailMessages,
  syncConnectedMailboxMessages,
  setMailboxConnectStatus,
}: MailboxAutoSyncInput) {
  useEffect(() => {
    if (!selectedCompanyId || emailConnection?.status !== 'connected') {
      setEmailMessages([]);
      return undefined;
    }

    let cancelled = false;

    async function loadAndSyncMessages() {
      try {
        await syncConnectedMailboxMessages(selectedCompanyId);
        if (cancelled) return;
      } catch (error) {
        if (cancelled) return;
        setMailboxConnectStatus(error instanceof Error ? error.message : 'Mailbox sync failed.');
      }
    }

    void loadAndSyncMessages();

    return () => {
      cancelled = true;
    };
  }, [emailConnection?.status, selectedCompanyId]);
}
