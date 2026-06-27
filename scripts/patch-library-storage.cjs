const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const portalPath = path.join(root, 'src/CompanyPortal.tsx');
let content = fs.readFileSync(portalPath, 'utf8');

if (!content.includes("from './services/libraryStore'")) {
  content = content.replace(
    "import { loadMailboxMessages, syncMailboxMessages } from './services/mailboxMessages';\nimport { sendMailboxEmail } from './services/mailboxSend';",
    "import { loadMailboxMessages, syncMailboxMessages } from './services/mailboxMessages';\nimport { sendMailboxEmail } from './services/mailboxSend';\nimport { listLibraryDocuments, openLibraryDocument, uploadLibraryDocument } from './services/libraryStore';",
  );
}

content = content.replace(
  "  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>(initialLibraryDocuments);",
  "  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>([]);\n  const [libraryStatus, setLibraryStatus] = useState('');",
);
content = content.replace("    fileName: '',\n  });", "    fileName: '',\n    file: null,\n  });");

if (!content.includes('async function loadCompanyLibraryDocuments')) {
  const marker = "  useEffect(() => {\n    window.localStorage.setItem(CLIENT_PAGE_STORAGE_KEY, clientPage);\n  }, [clientPage]);";
  const libraryEffect = `${marker}\n\n  useEffect(() => {\n    if (!selectedCompanyId) {\n      setLibraryDocuments([]);\n      setLibraryStatus('');\n      return undefined;\n    }\n\n    let cancelled = false;\n\n    async function loadCompanyLibraryDocuments() {\n      setLibraryStatus('Loading documents...');\n      try {\n        const documents = await listLibraryDocuments(selectedCompanyId);\n        if (cancelled) return;\n        setLibraryDocuments(documents);\n        setLibraryStatus('');\n      } catch (error) {\n        if (cancelled) return;\n        setLibraryDocuments([]);\n        setLibraryStatus(error instanceof Error ? error.message : 'Library documents could not be loaded.');\n      }\n    }\n\n    void loadCompanyLibraryDocuments();\n\n    return () => {\n      cancelled = true;\n    };\n  }, [selectedCompanyId]);`;
  content = content.replace(marker, libraryEffect);
}

content = content.replace(
  "      fileName: file.name,\n      title: draft.title || file.name.replace(/\\.[^/.]+$/, ''),",
  "      fileName: file.name,\n      file,\n      title: draft.title || file.name.replace(/\\.[^/.]+$/, ''),",
);

const oldAdd = `  const addLibraryDocument = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!libraryDraft.title.trim()) return;

    setLibraryDocuments((documents) => [
      {
        id: \`lib-\${Date.now()}\`,
        title: libraryDraft.title.trim(),
        category: libraryDraft.category,
        system: libraryDraft.system.trim() || 'General',
        manufacturer: libraryDraft.manufacturer.trim() || 'Unknown',
        model: libraryDraft.model.trim() || 'Any model',
        format: libraryDraft.fileName.toLowerCase().match(/\\.(png|jpg|jpeg|webp)$/) ? 'Image' : 'PDF',
        tags: libraryDraft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        uploadedAt: '2026-06-12',
        fileSize: libraryDraft.fileName ? 'Pending storage' : 'Link / reference',
        uploadedBy: 'Company admin',
        summary: libraryDraft.fileName
          ? \`Uploaded file: \${libraryDraft.fileName}\`
          : 'Reference document added by the company admin.',
      },
      ...documents,
    ]);
    setLibraryDraft({
      title: '',
      category: 'Manual',
      system: profile.jobTypes[0]?.name ?? 'HVAC',
      manufacturer: '',
      model: '',
      tags: '',
      fileName: '',
    });
  };`;

const newAdd = `  const addLibraryDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!libraryDraft.title.trim()) {
      setLibraryStatus('Document title is required.');
      return;
    }
    if (!libraryDraft.file) {
      setLibraryStatus('Choose a file before adding it to the library.');
      return;
    }

    setLibraryStatus('Uploading document...');
    try {
      const savedDocument = await uploadLibraryDocument(selectedCompany.id, libraryDraft, currentPortalUser.name);
      setLibraryDocuments((documents) => [savedDocument, ...documents.filter((document) => document.id !== savedDocument.id)]);
      setLibraryDraft({
        title: '',
        category: 'Manual',
        system: profile.jobTypes[0]?.name ?? 'HVAC',
        manufacturer: '',
        model: '',
        tags: '',
        fileName: '',
        file: null,
      });
      setLibraryStatus('Document uploaded.');
    } catch (error) {
      setLibraryStatus(error instanceof Error ? error.message : 'Document could not be uploaded.');
    }
  };

  const handleOpenLibraryDocument = (document: LibraryDocument) => {
    openLibraryDocument(document).catch((error) => {
      setLibraryStatus(error instanceof Error ? error.message : 'Document could not be opened.');
    });
  };`;

content = content.replace(oldAdd, newAdd);

if (!content.includes('onOpenLibraryDocument={handleOpenLibraryDocument}')) {
  content = content.replace(
    '          onLibraryFileChange={handleLibraryFileChange}\n          onAddLibraryDocument={addLibraryDocument}',
    '          onLibraryFileChange={handleLibraryFileChange}\n          onAddLibraryDocument={addLibraryDocument}\n          onOpenLibraryDocument={handleOpenLibraryDocument}',
  );
}

// Add a small status line under the Library filters/page if the render target exists.
if (!content.includes('{libraryStatus ? <p className="access-status library-status">{libraryStatus}</p> : null}')) {
  content = content.replace(
    '          onOpenLibraryDocument={handleOpenLibraryDocument}\n        />',
    '          onOpenLibraryDocument={handleOpenLibraryDocument}\n        />\n        {libraryStatus ? <p className="access-status library-status">{libraryStatus}</p> : null}',
  );
}

fs.writeFileSync(portalPath, content);
console.log('Library Supabase storage patch applied.');
