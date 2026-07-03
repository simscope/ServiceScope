// client/src/pages/TechLibraryPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import UploadTechDoc from '../components/UploadTechDoc.jsx';

const pageWrap = {
  padding: '16px 18px',
};

const topBar = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  marginBottom: 12,
  flexWrap: 'wrap',
};

const searchWrap = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const searchInput = {
  padding: '8px 10px',
  borderRadius: 999,
  border: '1px solid #e5e7eb',
  minWidth: 220,
};

const selectStyle = {
  padding: '8px 10px',
  borderRadius: 999,
  border: '1px solid #e5e7eb',
};

const addBtn = {
  padding: '8px 14px',
  borderRadius: 999,
  border: 'none',
  cursor: 'pointer',
  background: '#2563eb',
  color: '#ffffff',
  fontSize: 14,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const tableWrap = {
  marginTop: 8,
  borderRadius: 12,
  overflow: 'hidden',
  border: '1px solid #e5e7eb',
  background: '#ffffff',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid #e5e7eb',
  background: '#f9fafb',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '6px 10px',
  borderBottom: '1px solid #f3f4f6',
  verticalAlign: 'top',
};

const badgeDocType = (t) => {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 500,
  };
  if (!t) return { ...base, background: '#e5e7eb', color: '#111827' };
  if (t === 'manual') return { ...base, background: '#dbeafe', color: '#1d4ed8' };
  if (t === 'wiring') return { ...base, background: '#fee2e2', color: '#b91c1c' };
  if (t === 'parts') return { ...base, background: '#dcfce7', color: '#15803d' };
  if (t === 'spec') return { ...base, background: '#fef9c3', color: '#854d0e' };
  if (t === 'company') return { ...base, background: '#e0f2fe', color: '#0369a1' };
  return { ...base, background: '#e5e7eb', color: '#111827' };
};

/* ===== стили блока "Документы фирмы" ===== */

const companyBlockWrap = {
  marginBottom: 16,
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid #e5e7eb',
  background: '#ffffff',
};

const companyHeaderRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
};

const companyHeaderTitle = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
};

const companyHeaderSub = {
  margin: 0,
  fontSize: 12,
  color: '#6b7280',
};

const companyDocsRowWrap = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const companyDocBtn = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '6px 10px',
  borderRadius: 999,
  border: '1px solid #d1d5db',
  background: '#f9fafb',
  cursor: 'pointer',
  fontSize: 12,
  minWidth: 160,
  maxWidth: 260,
};

const companyDocTitle = {
  fontWeight: 500,
};

const companyDocDesc = {
  fontSize: 11,
  color: '#6b7280',
  marginTop: 2,
};

export default function TechLibraryPage() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [showUpload, setShowUpload] = useState(false);

  const [role, setRole] = useState(null);
  const isAdmin = role === 'admin';
  const isTech = role === 'tech';

  useEffect(() => {
    try {
      const stored = localStorage.getItem('profile');
      if (stored) {
        const profile = JSON.parse(stored);
        if (profile?.role) setRole(profile.role);
      }
    } catch (e) {
      console.warn('Не удалось прочитать профиль из localStorage', e);
    }
  }, []);

  const loadDocs = async () => {
    setLoading(true);
    setErr('');
    try {
      const { data, error } = await supabase
        .from('unit_docs')
        .select('*')
        .order('brand', { ascending: true })
        .order('model', { ascending: true })
        .order('title', { ascending: true });

      if (error) {
        console.error(error);
        throw new Error(error.message || 'Ошибка загрузки unit_docs');
      }
      setDocs(data || []);
    } catch (e) {
      console.error(e);
      setErr(e.message || 'Ошибка загрузки данных.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
  }, []);

  // фирменные документы (только is_company = true)
  const companyDocs = useMemo(
    () => (docs || []).filter((d) => d.is_company),
    [docs]
  );

  // документы, которые показываем в таблице: только НЕ фирменные
  const visibleDocs = useMemo(
    () => (docs || []).filter((d) => !d.is_company),
    [docs]
  );

  const categories = useMemo(() => {
    const set = new Set();
    (visibleDocs || []).forEach((d) => {
      if (d.category) set.add(d.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [visibleDocs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (visibleDocs || []).filter((d) => {
      if (categoryFilter !== 'all' && d.category !== categoryFilter) return false;

      if (!q) return true;
      const hay = [
        d.brand || '',
        d.model || '',
        d.title || '',
        d.description || '',
        d.category || '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [visibleDocs, search, categoryFilter]);

  const handleOpenFile = (url) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Удалить документ: ${row.brand} ${row.model} — ${row.title}?`)) return;
    try {
      const { error } = await supabase
        .from('unit_docs')
        .delete()
        .eq('id', row.id);
      if (error) {
        console.error(error);
        alert('Ошибка удаления.');
        return;
      }
      setDocs((prev) => prev.filter((d) => d.id !== row.id));
    } catch (e) {
      console.error(e);
      alert('Ошибка удаления.');
    }
  };

  const onUploaded = (row) => {
    if (row) {
      setDocs((prev) => [...prev, row]);
    } else {
      loadDocs();
    }
  };

  return (
    <div style={pageWrap}>
      {/* ===== блок "Документы фирмы" сверху — только для менеджеров/админов ===== */}
      {!isTech && (
        <div style={companyBlockWrap}>
          <div style={companyHeaderRow}>
            <div>
              <h2 style={companyHeaderTitle}>Документы фирмы</h2>
              <p style={companyHeaderSub}>
                Общие документы: W-9, страховка, лицензии, формы и т.д.
              </p>
            </div>
          </div>

          {companyDocs.length === 0 ? (
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
              Пока нет документов фирмы. При добавлении выберите тип "Документы фирмы".
            </p>
          ) : (
            <div style={companyDocsRowWrap}>
              {companyDocs.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  style={companyDocBtn}
                  onClick={() => handleOpenFile(d.file_url)}
                >
                  <span style={companyDocTitle}>{d.title || 'Без названия'}</span>
                  {d.description && (
                    <span style={companyDocDesc}>{d.description}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== основная часть: тех. база ===== */}
      <div style={topBar}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Техническая база</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            Поиск мануалов и схем по бренду, модели и описанию. Кнопка “Add document” — добавить новый PDF.
          </p>
        </div>

        <button
          type="button"
          style={addBtn}
          onClick={() => setShowUpload(true)}
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>＋</span>
          <span>Add document</span>
        </button>
      </div>

      <div style={searchWrap}>
        <input
          style={searchInput}
          placeholder="Поиск по бренду / модели / названию..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={selectStyle}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">Все категории</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {loading && <span style={{ fontSize: 13, color: '#6b7280' }}>Загрузка...</span>}
        {err && <span style={{ fontSize: 13, color: '#b91c1c' }}>{err}</span>}
      </div>

      <div style={tableWrap}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Категория</th>
              <th style={thStyle}>Бренд</th>
              <th style={thStyle}>Модель</th>
              <th style={thStyle}>Документ</th>
              <th style={thStyle}>Тип</th>
              <th style={thStyle}>Описание</th>
              <th style={thStyle}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr>
                <td style={tdStyle} colSpan={7}>
                  <span style={{ color: '#6b7280' }}>
                    Ничего не найдено. Попробуйте другой запрос или добавьте документ.
                  </span>
                </td>
              </tr>
            )}
            {filtered.map((d) => {
              const isCompanyDoc = d.is_company;
              return (
                <tr key={d.id}>
                  <td style={tdStyle}>{d.category || '—'}</td>
                  <td style={tdStyle}>{d.brand}</td>
                  <td style={tdStyle}>{d.model}</td>
                  <td style={tdStyle}>{d.title}</td>
                  <td style={tdStyle}>
                    <span style={badgeDocType(d.doc_type)}>
                      {d.doc_type || '—'}
                    </span>
                  </td>
                  <td style={tdStyle} title={d.description || ''}>
                    {d.description || '—'}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        style={{
                          padding: '4px 10px',
                          borderRadius: 999,
                          border: '1px solid #d1d5db',
                          background: '#f9fafb',
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                        onClick={() => handleOpenFile(d.file_url)}
                      >
                        Открыть
                      </button>
                      {/* Удалять фирменные доки — только админ, но сюда они уже не попадают;
                          проверка оставлена для обычных доков */}
                      {(!isCompanyDoc || isAdmin) && (
                        <button
                          type="button"
                          style={{
                            padding: '4px 10px',
                            borderRadius: 999,
                            border: '1px solid #fecaca',
                            background: '#fef2f2',
                            color: '#b91c1c',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                          onClick={() => handleDelete(d)}
                        >
                          Удалить
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showUpload && (
        <UploadTechDoc
          onClose={() => setShowUpload(false)}
          onSaved={onUploaded}
        />
      )}
    </div>
  );
}
