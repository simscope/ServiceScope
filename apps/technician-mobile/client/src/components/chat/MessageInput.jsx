import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';

/**
 * Поле ввода сообщений.
 * Самостоятельно:
 *  - берет текущего user из Supabase
 *  - (опц.) грузит первый выбранный файл в Storage (bucket "chat-attachments")
 *  - вставляет сообщение в public.chat_messages с полями:
 *      chat_id, body, file_url, file_name, file_type, file_size, attachment_url
 *
 * Props:
 *  - chatId: UUID активного чата
 *  - disabled?: boolean
 *  - canSend?: boolean               // переопределяет внутреннюю логику доступности кнопки
 *  - onSent?: (insertedMessageLike)  // колбэк после удачной отправки
 *  - onTypingPulse?: () => void      // "печатает…" с легким дебаунсом
 *
 * Требования к БД:
 *  - chat_messages: колонки body (text), author_id (uuid, DEFAULT auth.uid()), chat_id (uuid)
 *                   file_url, file_name, file_type, file_size, attachment_url (text) — опционально
 *  - RLS для INSERT разрешает писать участнику чата; author_id через DEFAULT
 *  - Для файлов создать Storage bucket "chat-attachments" (public) или поменять имя ниже
 */

const STORAGE_BUCKET = 'chat-attachments';

export default function MessageInput({
  chatId,
  disabled = false,
  canSend,
  onSent,
  onTypingPulse,
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]); // File[]
  const [sending, setSending] = useState(false);

  const inputRef = useRef(null);
  const fileRef = useRef(null);

  const [userId, setUserId] = useState(null);
  useEffect(() => {
    let sub;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUserId(data?.session?.user?.id || null);
      sub = supabase.auth.onAuthStateChange((_e, s) => {
        setUserId(s?.user?.id || null);
      }).data?.subscription;
    })();
    return () => sub?.unsubscribe?.();
  }, []);

  const normalizedCanSend = useMemo(() => {
    const hasContent = text.trim().length > 0 || files.length > 0;
    const ok = !!chatId && !disabled && !sending && !!userId && hasContent;
    return canSend ?? ok;
  }, [canSend, disabled, sending, chatId, userId, text, files]);

  // "печатает…" дебаунс
  const typingDebounceRef = useRef(null);
  const pulseTyping = useCallback(() => {
    if (!onTypingPulse) return;
    clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(() => {
      try { onTypingPulse(); } catch {}
    }, 300);
  }, [onTypingPulse]);
  useEffect(() => () => clearTimeout(typingDebounceRef.current), []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleChooseFiles = (e) => {
    const chosen = Array.from(e.target.files || []);
    if (!chosen.length) return;
    setFiles(prev => [...prev, ...chosen]);
  };

  const removeFileAt = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
    inputRef.current?.focus();
  };

  const clearForm = () => {
    setText('');
    setFiles([]);
    try { if (fileRef.current) fileRef.current.value = ''; } catch {}
  };

  // загрузка одного файла в Storage -> публичный URL
  const uploadFirstFile = async () => {
    if (!files.length) return null;
    const file = files[0];
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${chatId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    // если бакета нет/приватный — просто не прикрепляем файл
    const up = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });
    if (up.error) {
      console.warn('[CHAT] file upload error:', up.error?.message || up.error);
      return null;
    }
    const pub = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    const publicUrl = pub?.data?.publicUrl || null;

    return {
      file_url: publicUrl,
      attachment_url: publicUrl,
      file_name: file.name,
      file_type: file.type || null,
      file_size: file.size || null,
    };
  };

  const submit = async () => {
    if (!normalizedCanSend) return;
    const body = text.trim();
    if (!body && files.length === 0) return;

    setSending(true);
    try {
      let fileFields = null;
      if (files.length > 0) {
        fileFields = await uploadFirstFile();
      }

      const row = {
        chat_id: chatId,
        body: body || (fileFields ? '' : null), // если только файл — допустим пустой текст
        ...(fileFields || {}),
      };

      const { data, error } = await supabase
        .from('chat_messages')
        .insert(row)
        .select('id, chat_id, author_id, body, file_url, file_name, file_type, file_size, attachment_url, created_at')
        .single();

      if (error) throw error;

      onSent?.(data || row);
      clearForm();
    } catch (err) {
      console.error('[CHAT] send error:', err);
      alert(err?.message || 'Не удалось отправить сообщение');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8 }}>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        <textarea
          ref={inputRef}
          rows={2}
          placeholder="Напишите сообщение… (Enter — отправить, Shift+Enter — новая строка)"
          value={text}
          onChange={(e) => { setText(e.target.value); pulseTyping(); }}
          onKeyDown={handleKeyDown}
          disabled={disabled || sending || !chatId}
          style={{
            width:'100%',
            resize:'none',
            border:'1px solid #e5e7eb',
            borderRadius:8,
            padding:'10px 12px',
            outline:'none'
          }}
        />

        {files.length > 0 && (
          <div style={{
            display:'flex', flexWrap:'wrap', gap:8,
            background:'#f9fafb', border:'1px dashed #e5e7eb', borderRadius:8, padding:8
          }}>
            {files.map((f, i) => (
              <div key={i} style={{
                display:'flex', alignItems:'center', gap:8,
                border:'1px solid #e5e7eb', borderRadius:8, padding:'6px 8px', background:'#fff'
              }}>
                <span style={{ fontSize:12, color:'#374151' }}>
                  {f.name} {f.size ? `(${Math.round(f.size/1024)} KB)` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => removeFileAt(i)}
                  style={{
                    border:'none', background:'transparent', color:'#ef4444',
                    cursor:'pointer', fontWeight:700, fontSize:12
                  }}
                  title="Убрать"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <label
            style={{
              display:'inline-flex', alignItems:'center', gap:6,
              border:'1px solid #e5e7eb', borderRadius:8, padding:'8px 10px',
              cursor:'pointer', background:'#fff', fontWeight:600
            }}
          >
            📎 Файл
            <input
              ref={fileRef}
              type="file"
              multiple
              onChange={handleChooseFiles}
              style={{ display:'none' }}
              disabled={disabled || sending || !chatId}
            />
          </label>

          <button
            type="button"
            onClick={submit}
            disabled={!normalizedCanSend}
            style={{
              padding:'10px 16px',
              borderRadius:8,
              border:'none',
              background: normalizedCanSend ? '#2563eb' : '#cbd5e1',
              color:'#fff',
              fontWeight:700,
              cursor: normalizedCanSend ? 'pointer' : 'not-allowed'
            }}
          >
            Отправить
          </button>
        </div>
      </div>
    </div>
  );
}
