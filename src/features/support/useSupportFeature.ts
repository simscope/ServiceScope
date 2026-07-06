import { useState } from 'react';
import type { NewSupportTicketForm } from '../../types';

type SupportRequestDraft = Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>;

const emptySupportRequest: SupportRequestDraft = {
  kind: 'change',
  priority: 'normal',
  subject: '',
  message: '',
};

export function useSupportFeature() {
  const [request, setRequest] = useState<SupportRequestDraft>(emptySupportRequest);
  const [requestTouched, setRequestTouched] = useState(false);
  const [supportReplyDrafts, setSupportReplyDrafts] = useState<Record<string, string>>({});

  const resetRequest = () => {
    setRequest(emptySupportRequest);
    setRequestTouched(false);
  };

  return {
    request,
    setRequest,
    requestTouched,
    setRequestTouched,
    supportReplyDrafts,
    setSupportReplyDrafts,
    resetRequest,
  };
}
