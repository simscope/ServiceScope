// client/src/components/nav/ChatNavLink.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';

function Badge({ count }) {
  if (!count) return null;
  const text = count > 99 ? '99+' : String(count);
  return (
    <span
      aria-label={`${text} непрочитанных`}
      style={{
        background: '#ef4444',
        color: '#fff',
        borderRadius: 9999,
        padding: '0 8px',
        minWidth: 20,
        height: 20,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 700,
        lineHeight: '20px',
        marginLeft: 8,
        userSelect: 'none',
      }}
    >
      {text}
    </span>
  );
}

/**
 * props:
 * - href: string (например "/chat")
 * - label: string (например "Чат")
 * - active: boolean (подсветка текущего пункта меню)
 * - onClick: optional
 *
 * Показывает бэйдж непрочитанных; считает на сервере через RPC:
 *   - get_unread_by_chat()
 *   - mark_chat_read(chat_id) — вызывается внутри ChatPage (не здесь).
 */
export default function ChatNavLink({ href = '/chat', label = 'Чат', active = false, onClick }) {
  const [selfId, setSelfId] = useState(null);
  const [total, setTotal] = useState(() => {
    const raw = (typeof window !== 'undefined') ? window.localStorage.getItem('CHAT_UNREAD_TOTAL') : null;
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  });

  const chanRef = useRef(null);
  const subRef = useRef(null);
  const debounceRef = useRef(null);

  const fetchTotal = useMemo(() => async () => {
    if (!selfId) return;
    const { data, error } = await supabase.rpc('get_unread_by_chat');
    if (error) {
      // не дёргаем консоль каждый раз
      // console.warn('[NAV] get_unread_by_chat error:', error);
      return;
    }
    const sum = (data || []).reduce((s, r) => s + (Number(r.unread) || 0), 0);
    setTotal(sum);
    // синхронизируем с локалстораджем, чтобы ChatPage (если откроется) сразу увидел
    try {
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(sum));
    } catch {}
  }, [selfId]);

  const fetchTotalDebounced = useMemo(() => {
    return () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchTotal();
      }, 250);
    };
  }, [fetchTotal]);

  useEffect(() => {
    let authSub;
    (async () => {
      // 1) узнаём себя
      const { data } = await supabase.auth.getSession();
      const uid = data?.session?.user?.id ?? null;
      setSelfId(uid);

      // и подписываемся на смену пользователя
      authSub = supabase.auth.onAuthStateChange((_e, s) => {
        const next = s?.user?.id ?? null;
        setSelfId(next);
      }).data?.subscription;
    })();

    return () => authSub?.unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!selfId) {
      setTotal(0);
      return;
    }

    // начальная загрузка с сервера
    fetchTotal();

    // слушаем твоё локальное событие из ChatPage (мгновенная синхронизация)
    const onChanged = (e) => {
      const n = e?.detail?.total;
      if (typeof n === 'number') setTotal(n);
    };
    window.addEventListener('chat-unread-changed', onChanged);

    // realtime: на любое новое сообщение пересчитываем
    // плюс слушаем обновления last_read_at конкретно для нашего user_id
    if (chanRef.current) {
      try { supabase.removeChannel(chanRef.current); } catch {}
      chanRef.current = null;
    }
    const ch = supabase
      .channel('nav-chat-unread')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => fetchTotalDebounced()
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_members', filter: `member_id=eq.${selfId}` },
        () => fetchTotalDebounced()
      )
      .subscribe();
    chanRef.current = ch;

    return () => {
      window.removeEventListener('chat-unread-changed', onChanged);
      try { if (chanRef.current) supabase.removeChannel(chanRef.current); } catch {}
      chanRef.current = null;
    };
  }, [selfId, fetchTotal, fetchTotalDebounced]);

  // Отрисовка
  return (
    <a
      href={href}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 8,
        textDecoration: 'none',
        color: active ? '#1d4ed8' : '#111827',
        background: active ? '#e0e7ff' : 'transparent',
        fontWeight: 600,
      }}
      aria-current={active ? 'page' : undefined}
    >
      <span>{label}</span>
      <Badge count={total} />
    </a>
  );
}
