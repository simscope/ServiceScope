import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { NewSupportTicketForm } from '../../types';

type SupportRequestDraft = Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>;

type SupportActionsInput = {
  request: SupportRequestDraft;
  setRequestTouched: Dispatch<SetStateAction<boolean>>;
  resetRequest: () => void;
  supportReplyDrafts: Record<string, string>;
  setSupportReplyDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  onCreateRequest: (request: SupportRequestDraft) => void;
  onReplyToTicket?: (ticketId: string, body: string) => void;
  stopPortalWrite: (action: string) => boolean;
};

export function makeSupportActions({
  request,
  setRequestTouched,
  resetRequest,
  supportReplyDrafts,
  setSupportReplyDrafts,
  onCreateRequest,
  onReplyToTicket,
  stopPortalWrite,
}: SupportActionsInput) {
  function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stopPortalWrite('sending support requests')) return;

    setRequestTouched(true);
    if (!request.subject.trim() || !request.message.trim()) return;

    onCreateRequest(request);
    resetRequest();
  }

  function handleSupportReply(event: FormEvent<HTMLFormElement>, ticketId: string) {
    event.preventDefault();
    const body = supportReplyDrafts[ticketId]?.trim() ?? '';
    if (!body || !onReplyToTicket) return;

    onReplyToTicket(ticketId, body);
    setSupportReplyDrafts((drafts) => ({ ...drafts, [ticketId]: '' }));
  }

  return {
    handleRequestSubmit,
    handleSupportReply,
  };
}
