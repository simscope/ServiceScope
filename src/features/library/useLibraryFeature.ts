import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import type { LibraryCategory, LibraryDocument, LibraryDraft, LibraryFormat } from '../../appTypes';
import type { CompanyOnboardingProfile } from '../../types';
import {
  deleteLibraryDocument,
  listLibraryDocuments,
  openLibraryDocument,
  uploadLibraryDocument,
} from '../../services/libraryStore';

type UseLibraryFeatureParams = {
  companyId: string;
  profile?: CompanyOnboardingProfile;
  currentUserName: string;
  canWrite: boolean;
  readOnlyMessage: string;
};

function createEmptyDraft(profile?: CompanyOnboardingProfile): LibraryDraft {
  return {
    title: '',
    category: 'Manual',
    system: profile?.jobTypes[0]?.name ?? 'HVAC',
    manufacturer: '',
    model: '',
    tags: '',
    fileName: '',
    file: null,
  };
}

export function useLibraryFeature({
  companyId,
  profile,
  currentUserName,
  canWrite,
  readOnlyMessage,
}: UseLibraryFeatureParams) {
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>([]);
  const [libraryStatus, setLibraryStatus] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryCategoryFilter, setLibraryCategoryFilter] = useState<'all' | LibraryCategory>('all');
  const [librarySystemFilter, setLibrarySystemFilter] = useState('all');
  const [libraryFormatFilter, setLibraryFormatFilter] = useState<'all' | LibraryFormat>('all');
  const [libraryDraft, setLibraryDraft] = useState<LibraryDraft>(() => createEmptyDraft(profile));

  useEffect(() => {
    setLibraryDraft((draft) => ({
      ...draft,
      system: draft.system || profile?.jobTypes[0]?.name || 'HVAC',
    }));
  }, [profile]);

  useEffect(() => {
    if (!companyId) {
      setLibraryDocuments([]);
      setLibraryStatus('');
      return undefined;
    }

    let cancelled = false;
    setLibraryStatus('Loading library...');

    listLibraryDocuments(companyId)
      .then((documents) => {
        if (cancelled) return;
        setLibraryDocuments(documents);
        setLibraryStatus('');
      })
      .catch((error) => {
        if (cancelled) return;
        setLibraryDocuments([]);
        setLibraryStatus(error instanceof Error ? error.message : 'Library could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const librarySystems = useMemo(
    () => Array.from(new Set([
      ...(profile?.jobTypes.map((jobType) => jobType.name) ?? []),
      ...libraryDocuments.map((document) => document.system),
    ])).filter(Boolean),
    [libraryDocuments, profile],
  );

  const filteredLibraryDocuments = useMemo(() => libraryDocuments.filter((document) => {
    const normalizedSearch = librarySearch.trim().toLowerCase();
    const matchesCategory = libraryCategoryFilter === 'all' || document.category === libraryCategoryFilter;
    const matchesSystem = librarySystemFilter === 'all' || document.system === librarySystemFilter;
    const matchesFormat = libraryFormatFilter === 'all' || document.format === libraryFormatFilter;
    const haystack = [
      document.title,
      document.category,
      document.system,
      document.manufacturer,
      document.model,
      document.format,
      document.summary,
      document.tags.join(' '),
    ]
      .join(' ')
      .toLowerCase();

    return matchesCategory && matchesSystem && matchesFormat && (!normalizedSearch || haystack.includes(normalizedSearch));
  }), [libraryCategoryFilter, libraryDocuments, libraryFormatFilter, librarySearch, librarySystemFilter]);

  const handleLibraryFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLibraryDraft((draft) => ({
      ...draft,
      fileName: file.name,
      file,
      title: draft.title || file.name.replace(/\.[^/.]+$/, ''),
    }));
  };

  const addLibraryDocument = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWrite) {
      setLibraryStatus(`${readOnlyMessage} adding library documents.`);
      return;
    }
    if (!companyId) {
      setLibraryStatus('Select a company before uploading documents.');
      return;
    }
    if (!libraryDraft.title.trim()) {
      setLibraryStatus('Document title is required.');
      return;
    }
    if (!libraryDraft.file) {
      setLibraryStatus('Choose a file before adding it to the library.');
      return;
    }

    setLibraryStatus('Uploading document...');
    uploadLibraryDocument(companyId, libraryDraft, currentUserName)
      .then((document) => {
        setLibraryDocuments((documents) => [document, ...documents]);
        setLibraryDraft(createEmptyDraft(profile));
        setLibraryStatus(`${document.title} added to the library.`);
      })
      .catch((error) => {
        setLibraryStatus(error instanceof Error ? error.message : 'Document could not be uploaded.');
      });
  };

  const handleOpenLibraryDocument = (document: LibraryDocument) => {
    setLibraryStatus(`Opening ${document.title}...`);
    openLibraryDocument(document)
      .then(() => setLibraryStatus(''))
      .catch((error) => {
        setLibraryStatus(error instanceof Error ? error.message : 'Document could not be opened.');
      });
  };

  const handleDeleteLibraryDocument = (document: LibraryDocument) => {
    if (!canWrite) {
      setLibraryStatus(`${readOnlyMessage} deleting library documents.`);
      return;
    }
    if (!companyId) {
      setLibraryStatus('Select a company before deleting documents.');
      return;
    }

    setLibraryStatus(`Deleting ${document.title}...`);
    deleteLibraryDocument(companyId, document)
      .then(() => {
        setLibraryDocuments((documents) => documents.filter((item) => item.id !== document.id));
        setLibraryStatus(`${document.title} removed from the library.`);
      })
      .catch((error) => {
        setLibraryStatus(error instanceof Error ? error.message : 'Document could not be deleted.');
      });
  };

  return {
    libraryDocuments,
    libraryStatus,
    librarySystems,
    filteredLibraryDocuments,
    libraryDraft,
    setLibraryDraft,
    librarySearch,
    setLibrarySearch,
    libraryCategoryFilter,
    setLibraryCategoryFilter,
    librarySystemFilter,
    setLibrarySystemFilter,
    libraryFormatFilter,
    setLibraryFormatFilter,
    handleLibraryFileChange,
    addLibraryDocument,
    handleOpenLibraryDocument,
    handleDeleteLibraryDocument,
  };
}
