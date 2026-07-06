import { useEffect, useState, type FormEvent } from 'react';
import type { JobInboxForm, JobInboxItem, JobInboxStatus } from '../../appTypes';
import {
  createJobInboxItem,
  listJobInboxItems,
  updateJobInboxStatus,
} from './api';

const emptyJobInboxForm: JobInboxForm = {
  source: 'manual',
  clientName: '',
  clientPhone: '',
  clientEmail: '',
  address: '',
  message: '',
};

type UseJobInboxFeatureParams = {
  companyId: string;
  canWrite: boolean;
  readOnlyMessage: string;
};

export function useJobInboxFeature({
  companyId,
  canWrite,
  readOnlyMessage,
}: UseJobInboxFeatureParams) {
  const [items, setItems] = useState<JobInboxItem[]>([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | JobInboxStatus>('new');
  const [form, setForm] = useState<JobInboxForm>(emptyJobInboxForm);

  useEffect(() => {
    if (!companyId) {
      setItems([]);
      setStatus('');
      return undefined;
    }

    let cancelled = false;
    listJobInboxItems(companyId)
      .then((savedItems) => {
        if (cancelled) return;
        setItems(savedItems);
        setStatus('');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load job inbox', error);
        setItems([]);
        setStatus(error instanceof Error ? error.message : 'Job Inbox could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const createItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite) {
      setStatus(`${readOnlyMessage} creating job inbox items.`);
      return;
    }
    if (!form.clientName.trim() && !form.clientPhone.trim() && !form.clientEmail.trim() && !form.message.trim()) {
      setStatus('Add a client, phone, email, or message before saving an inbox item.');
      return;
    }

    setStatus('Saving inbox item...');
    createJobInboxItem(companyId, form)
      .then((item) => {
        setItems((currentItems) => [item, ...currentItems]);
        setForm(emptyJobInboxForm);
        setStatus('Inbox item saved.');
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Inbox item could not be saved.');
      });
  };

  const updateItemStatus = (item: JobInboxItem, nextStatus: JobInboxStatus) => {
    if (!canWrite) {
      setStatus(`${readOnlyMessage} updating job inbox items.`);
      return;
    }

    setStatus('Updating inbox item...');
    updateJobInboxStatus(companyId, item.id, nextStatus)
      .then((savedItem) => {
        setItems((currentItems) => currentItems.map((candidate) => (candidate.id === savedItem.id ? savedItem : candidate)));
        setStatus(`Inbox item marked ${nextStatus}.`);
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Inbox item could not be updated.');
      });
  };

  const markConverted = async (item: JobInboxItem, jobId: string) => {
    const savedItem = await updateJobInboxStatus(companyId, item.id, 'converted', jobId);
    setItems((currentItems) => currentItems.map((candidate) => (candidate.id === savedItem.id ? savedItem : candidate)));
    return savedItem;
  };

  return {
    items,
    form,
    setForm,
    status,
    setStatus,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    createItem,
    updateItemStatus,
    markConverted,
  };
}
