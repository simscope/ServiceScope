// client/src/components/chat/ChatMessage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';

const STORAGE_BUCKET = 'chat-attachments';

export default function ChatMessage({ m, isMine, receipts, memberNames }) {
  // receipts[m.id] может содержать Set или Array
  const r = receipts?.[m.id] || {};
  const deliveredCount = useMemo(() => {
    if (!r.delivered) return 0;
    if (r.delivered instanceof Set) return r.delivered.size;
    if (Array.isArray(r.delivered)) return r.delivered.length;
    return 0;
  }, [r.delivered]);
  const readCount = useMemo(() => {
    if (!r.read) return 0;
    if (r.read instanceof Set) return r.read.size;
    if (Array.isArray(r.read)) return r.read.length;
    return 0;
  }, [r.read]);

  const delivered = deliveredCount > 0;
  const read = readCount > 0;

  // превью вложений
  const [fileUrl, setFileUrl] = useState(null);
  const [isImage, setIsImage] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const raw = m?.file_url || m?.attachment_url || null;
      if (!raw) { if (alive) setFileUrl(null); return; }

      const http = /^https?:\/\//i.test(raw);
      if (http) {
        if (alive) setFileUrl(raw);
      } else {
        // считаем, что это путь в Storage
        try {
          const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(raw, 3600);
          if (alive) setFileUrl(error ? null : (data?.signedUrl || null));
        } catch {
          if (alive) setFileUrl(null);
        }
      }
    })();
    return () => { alive = false; };
  }, [m?.file_url, m?.attachment_url]);

  useEffect(() => {
    const t = (m?.file_type || '').toLowerCase();
    setIsImage(t.startsWith('image/'));
  }, [m?.file_type]);

  const readersTitle = useMemo(() => {
    if (!read) return delivered ? 'Доставлено' : 'Отправлено';
    const ids = r.read instanceof Set ? Array.from(r.read) : Array.isArray(r.read) ? r.read : [];
    const names = ids.map(id => memberNames?.[id] || id);
    return names.length ? `Прочитали: ${names.join(', ')}` : 'Прочитано';
  }, [read, delivered, r.read, memberNames]);

  return (
    <div style={{ display:'flex', justifyContent: isMine ? 'flex-end' : 'flex-start', margin:'6px 0' }}>
      <div style={{
        maxWidth:'72%',
        padding:'8px 10px',
        borderRadius:10,
        background: isMine ? '#e8f0fe' : '#f5f5f5',
        wordBreak:'break-word'
      }}>
        {!!m?.body && <div style={{ whiteSpace:'pre-wrap' }}>{m.body}</div>}

        {fileUrl && (
          <div style={{ marginTop: 6 }}>
            {isImage ? (
              <a href={fileUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <img src={fileUrl} style={{ maxWidth:'50%', borderRadius:6 }} />
              </a>
            ) : (
              <a href={fileUrl} target="_blank" rel="noreferrer">
                {m?.file_name || 'file'} {m?.file_size ? `(${Math.round(m.file_size/1024)} KB)` : ''}
              </a>
            )}
          </div>
        )}

        <div style={{ display:'flex', alignItems:'center', gap:8, color:'#94a3b8', fontSize:11, marginTop:6 }}>
          <span>
            {m?.created_at
              ? new Date(m.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
              : ''}
          </span>
          {isMine && (
            <span title={readersTitle} style={{ userSelect:'none' }}>
              {!delivered && '✔'}
              {delivered && !read && '✔✔'}
              {delivered && read && <span style={{ color:'#1a73e8' }}>✔✔</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
