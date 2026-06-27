import type { ChangeEvent, FormEvent } from 'react';
import { BookOpen, Plus, Search } from 'lucide-react';
import type { LibraryCategory, LibraryDocument, LibraryDraft, LibraryFormat } from '../../appTypes';

export function KnowledgePage({
  libraryDocuments,
  librarySystems,
  filteredLibraryDocuments,
  libraryDraft,
  onLibraryDraftChange,
  libraryCategories,
  libraryFormats,
  librarySearch,
  onLibrarySearchChange,
  libraryCategoryFilter,
  onLibraryCategoryFilterChange,
  librarySystemFilter,
  onLibrarySystemFilterChange,
  libraryFormatFilter,
  onLibraryFormatFilterChange,
  onLibraryFileChange,
  onAddLibraryDocument,
  onOpenLibraryDocument,
}: {
  libraryDocuments: LibraryDocument[];
  librarySystems: string[];
  filteredLibraryDocuments: LibraryDocument[];
  libraryDraft: LibraryDraft;
  onLibraryDraftChange: (draft: LibraryDraft) => void;
  libraryCategories: LibraryCategory[];
  libraryFormats: LibraryFormat[];
  librarySearch: string;
  onLibrarySearchChange: (value: string) => void;
  libraryCategoryFilter: 'all' | LibraryCategory;
  onLibraryCategoryFilterChange: (value: 'all' | LibraryCategory) => void;
  librarySystemFilter: string;
  onLibrarySystemFilterChange: (value: string) => void;
  libraryFormatFilter: 'all' | LibraryFormat;
  onLibraryFormatFilterChange: (value: 'all' | LibraryFormat) => void;
  onLibraryFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAddLibraryDocument: (event: FormEvent<HTMLFormElement>) => void;
  onOpenLibraryDocument?: (document: LibraryDocument) => void;
}) {
  return (
    <section className="library-page">
      <div className="library-header">
        <div>
          <p className="eyebrow">Technical documents</p>
          <h1>Library</h1>
        </div>
        <div className="library-summary">
          <span>
            <strong>{libraryDocuments.length}</strong>
            Documents
          </span>
          <span>
            <strong>{librarySystems.length}</strong>
            Systems
          </span>
          <span>
            <strong>{filteredLibraryDocuments.length}</strong>
            Search results
          </span>
        </div>
      </div>

      <div className="library-layout">
        <form className="library-upload-panel" onSubmit={onAddLibraryDocument}>
          <div>
            <p className="eyebrow">Upload</p>
            <h2>Add document</h2>
          </div>
          <label>
            File
            <input id="library-file-upload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" onChange={onLibraryFileChange} style={{ display: 'none' }} />
            <span className="library-file-picker-row">
              <label className="secondary-button compact library-file-picker-button" htmlFor="library-file-upload">
                Choose file
              </label>
              <span>{libraryDraft.fileName || 'No file selected'}</span>
            </span>
          </label>
          <label>
            Title
            <input value={libraryDraft.title} onChange={(event) => onLibraryDraftChange({ ...libraryDraft, title: event.target.value })} placeholder="Service manual, wiring diagram..." />
          </label>
          <div className="library-upload-row">
            <label>
              Category
              <select value={libraryDraft.category} onChange={(event) => onLibraryDraftChange({ ...libraryDraft, category: event.target.value as LibraryCategory })}>
                {libraryCategories.map((category) => (
                  <option value={category} key={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              System
              <input value={libraryDraft.system} onChange={(event) => onLibraryDraftChange({ ...libraryDraft, system: event.target.value })} placeholder="HVAC, Appliance..." />
            </label>
          </div>
          <div className="library-upload-row">
            <label>
              Manufacturer
              <input value={libraryDraft.manufacturer} onChange={(event) => onLibraryDraftChange({ ...libraryDraft, manufacturer: event.target.value })} placeholder="Carrier, True..." />
            </label>
            <label>
              Model
              <input value={libraryDraft.model} onChange={(event) => onLibraryDraftChange({ ...libraryDraft, model: event.target.value })} placeholder="48TC, T-49F..." />
            </label>
          </div>
          <label>
            Tags
            <input value={libraryDraft.tags} onChange={(event) => onLibraryDraftChange({ ...libraryDraft, tags: event.target.value })} placeholder="fault codes, compressor, install" />
          </label>
          <button className="primary-button" type="submit">
            <Plus size={18} aria-hidden="true" />
            Add to library
          </button>
        </form>

        <section className="library-browser">
          <div className="library-filters">
            <label className="library-search">
              <Search size={16} aria-hidden="true" />
              <input value={librarySearch} onChange={(event) => onLibrarySearchChange(event.target.value)} placeholder="Search title, model, tag, manufacturer..." />
            </label>
            <select value={libraryCategoryFilter} onChange={(event) => onLibraryCategoryFilterChange(event.target.value as 'all' | LibraryCategory)} aria-label="Filter by category">
              <option value="all">All categories</option>
              {libraryCategories.map((category) => (
                <option value={category} key={category}>
                  {category}
                </option>
              ))}
            </select>
            <select value={librarySystemFilter} onChange={(event) => onLibrarySystemFilterChange(event.target.value)} aria-label="Filter by system">
              <option value="all">All systems</option>
              {librarySystems.map((system) => (
                <option value={system} key={system}>
                  {system}
                </option>
              ))}
            </select>
            <select value={libraryFormatFilter} onChange={(event) => onLibraryFormatFilterChange(event.target.value as 'all' | LibraryFormat)} aria-label="Filter by format">
              <option value="all">All formats</option>
              {libraryFormats.map((format) => (
                <option value={format} key={format}>
                  {format}
                </option>
              ))}
            </select>
          </div>

          <div className="library-document-list">
            {filteredLibraryDocuments.map((document) => (
              <article className="library-document-card" key={document.id}>
                <div className="library-document-icon">
                  <BookOpen size={20} aria-hidden="true" />
                </div>
                <div>
                  <div className="library-document-topline">
                    <span>{document.category}</span>
                    <span>{document.format}</span>
                    <span>{document.system}</span>
                  </div>
                  <h3>{document.title}</h3>
                  <p>{document.summary}</p>
                  <div className="library-tags">
                    {document.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Brand</dt>
                    <dd>{document.manufacturer}</dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd>{document.model}</dd>
                  </div>
                  <div>
                    <dt>Uploaded</dt>
                    <dd>{document.uploadedAt}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{document.fileSize}</dd>
                  </div>
                </dl>
                <button className="secondary-button compact" type="button" onClick={() => onOpenLibraryDocument?.(document)}>
                  Open
                </button>
              </article>
            ))}
            {!filteredLibraryDocuments.length ? (
              <div className="empty-state compact-empty">
                <BookOpen size={24} aria-hidden="true" />
                <h3>No documents found</h3>
                <p>Change filters or add a new technical document.</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  );
}
