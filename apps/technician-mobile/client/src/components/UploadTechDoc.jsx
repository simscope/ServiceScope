// client/src/components/UploadTechDoc.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
};

const modal = {
  background: '#ffffff',
  borderRadius: 16,
  padding: '18px 20px',
  width: '100%',
  maxWidth: 560,
  boxShadow: '0 20px 40px rgba(15,23,42,0.3)',
};

const headerRow = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
};

const titleStyle = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
};

const closeBtn = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
};

const formGrid = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 10,
};

const label = {
  fontSize: 12,
  fontWeight: 500,
  color: '#374151',
};

const input = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid #d1d5db',
  fontSize: 13,
};

const select = {
  ...input,
};

const textarea = {
  ...input,
  minHeight: 60,
  resize: 'vertical',
};

const footer = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 12,
};

const btnGhost = {
  padding: '8px 14px',
  borderRadius: 999,
  border: '1px solid #d1d5db',
  background: '#ffffff',
  cursor: 'pointer',
  fontSize: 13,
};

const btnPrimary = {
  padding: '8px 16px',
  borderRadius: 999,
  border: 'none',
  background: '#2563eb',
  color: '#ffffff',
  cursor: 'pointer',
  fontSize: 13,
};

export default function UploadTechDoc({ onClose, onSaved }) {
  const [role, setRole] = useState(null);
  const isTech = role === 'tech';

  const [file, setFile] = useState(null);
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState('manual'); // manual | wiring | parts | spec | other | company
  const [description, setDescription] = useState('');

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');

    if (!file) {
      setErr('Выберите файл (PDF или другой документ).');
      return;
    }
    if (!brand.trim() || !model.trim() || !title.trim()) {
      setErr('Заполните Бренд, Модель и Название документа.');
      return;
    }

    setSaving(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}.${fileExt}`;

      // загружаем в bucket unit-docs (как и раньше)
      const { error: uploadError } = await supabase.storage
        .from('unit-docs')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        console.error(uploadError);
        throw new Error(uploadError.message || 'Ошибка загрузки файла');
      }

      const { data: publicUrlData } = supabase.storage
        .from('unit-docs')
        .getPublicUrl(filePath);

      const fileUrl = publicUrlData?.publicUrl;
      if (!fileUrl) {
        throw new Error('Не удалось получить публичный URL файла.');
      }

      // "Документы фирмы" — это docType === 'company'
      const isCompany = docType === 'company';

      const { data, error: insertError } = await supabase
        .from('unit_docs')
        .insert([
          {
            category: category || null,
            brand: brand.trim(),
            model: model.trim(),
            title: title.trim(),
            doc_type: docType,
            description: description || null,
            file_url: fileUrl,
            is_company: isCompany,
          },
        ])
        .select('*')
        .single();

      if (insertError) {
        console.error(insertError);
        throw new Error(insertError.message || 'Ошибка сохранения документа');
      }

      if (onSaved) onSaved(data);
      if (onClose) onClose();
    } catch (e2) {
      console.error(e2);
      setErr(e2.message || 'Ошибка сохранения.');
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      if (!saving && onClose) onClose();
    }
  };

  return (
    <div style={overlay} onClick={handleOverlayClick}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={headerRow}>
          <h2 style={titleStyle}>Добавить документ</h2>
          <button type="button" style={closeBtn} onClick={onClose} disabled={saving}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={formGrid}>
          {/* Файл */}
          <div>
            <div style={label}>Файл (PDF / Excel / др.)</div>
            <input
              type="file"
              style={input}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={saving}
            />
          </div>

          {/* Категория */}
          <div>
            <div style={label}>Категория</div>
            <input
              style={input}
              placeholder="Например: Dishwasher, Washer, Mini-split..."
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={saving}
            />
          </div>

          {/* Бренд */}
          <div>
            <div style={label}>Бренд *</div>
            <input
              style={input}
              placeholder="Hobart, Samsung, Trane..."
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              disabled={saving}
            />
          </div>

          {/* Модель */}
          <div>
            <div style={label}>Модель *</div>
            <input
              style={input}
              placeholder="LXe, AJ036TXS4CHAA..."
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={saving}
            />
          </div>

          {/* Название документа */}
          <div>
            <div style={label}>Название документа *</div>
            <input
              style={input}
              placeholder="Service manual, Wiring diagram..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={saving}
            />
          </div>

          {/* Тип документа */}
          <div>
            <div style={label}>Тип</div>
            <select
              style={select}
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              disabled={saving}
            >
              <option value="manual">Service manual</option>
              <option value="wiring">Wiring diagram</option>
              <option value="parts">Parts list</option>
              <option value="spec">Spec sheet</option>
              <option value="other">Other</option>
              {!isTech && (
                <option value="company">Документы фирмы</option>
              )}
            </select>
          </div>

          {/* Описание */}
          <div>
            <div style={label}>Описание</div>
            <textarea
              style={textarea}
              placeholder="Коротко: undercounter dishwasher 208-240V, steam, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={saving}
            />
          </div>

          {err && (
            <div style={{ fontSize: 12, color: '#b91c1c' }}>
              {err}
            </div>
          )}

          <div style={footer}>
            <button
              type="button"
              style={btnGhost}
              onClick={onClose}
              disabled={saving}
            >
              Отмена
            </button>
            <button
              type="submit"
              style={btnPrimary}
              disabled={saving}
            >
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
