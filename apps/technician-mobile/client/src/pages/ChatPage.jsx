// client/src/pages/ChatPage.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

import ChatList from '../components/chat/ChatList.jsx';
import MessageList from '../components/chat/MessageList.jsx';
import MessageInput from '../components/chat/MessageInput.jsx';
import ChatHeader from '../components/chat/ChatHeader.jsx';

// Колонка пользователя в message_receipts
const RECEIPTS_USER_COLUMN = 'user_id';

// Поля профиля автора сообщения
const PROFILE_FIELDS = 'id, full_name, role';

// ВАЖНО: это имя FK-алиаса chat_messages.author_id -> profiles.id
// Проверь в Table Editor → chat_messages → Foreign Keys и, если нужно, замени.
const AUTHOR_FK_ALIAS = 'chat_messages_author_fk';

export default function ChatPage() {
  /** ─────────────────────────  AUTH  ───────────────────────── */
  const [user, setUser] = useState(null);

  useEffect(() => {
    let sub;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data?.session?.user ?? null);
      sub = supabase.auth
        .onAuthStateChange((_e, s) => setUser(s?.user ?? null))
        .data?.subscription;
    })();
    return () => sub?.unsubscribe?.();
  }, []);

  const selfId = user?.id ?? null;
  const canSend = Boolean(selfId);

  /** ───────────────────────  СПИСОК ЧАТОВ  ──────────────────── */
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [unreadByChat, setUnreadByChat] = useState({}); // { [chat_id]: number }

  const loadChats = useCallback(async () => {
    // Политика RLS на chats должна возвращать только чаты, где user — член
    const { data, error } = await supabase
      .from('chats')
      .select('id, title, is_group, updated_at, deleted')
      .eq('deleted', false)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[CHAT] load chats error:', error);
      setChats([]);
      return;
    }

    const mapped = (data || []).map((r) => ({
      chat_id: r.id,
      title: r.title,
      is_group: r.is_group,
      last_at: r.updated_at,
    }));

    setChats(mapped);
    // Выбираем первый чат, если активный не установлен
    if (!activeChatId && mapped.length) setActiveChatId(mapped[0].chat_id);
  }, [activeChatId]);

  const loadUnreadCounters = useCallback(async () => {
    // RPC должна быть уже создана в БД (как у тебя)
    const { data, error } = await supabase.rpc('get_unread_by_chat');
    if (error) {
      console.warn('[CHAT] unread counters rpc error:', error);
      return;
    }
    const dict = {};
    (data || []).forEach((row) => {
      dict[row.chat_id] = Number(row.unread) || 0;
    });
    setUnreadByChat(dict);
  }, []);

  useEffect(() => {
    let channel;

    (async () => {
      await loadChats();
      await loadUnreadCounters();
    })();

    // Реалтайм: при новых сообщениях — поднимаем чат вверх и инкрементим бэйдж
    channel = supabase
      .channel('chats-overview')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const m = payload.new;

          setChats((prev) => {
            const arr = [...prev];
            const i = arr.findIndex((c) => c.chat_id === m.chat_id);
            if (i >= 0) {
              arr[i] = { ...arr[i], last_at: m.created_at };
              arr.sort(
                (a, b) =>
                  new Date(b.last_at || 0) - new Date(a.last_at || 0),
              );
            }
            return arr;
          });

          if (selfId && m.author_id !== selfId && m.chat_id !== activeChatId) {
            setUnreadByChat((prev) => ({
              ...prev,
              [m.chat_id]: (prev[m.chat_id] || 0) + 1,
            }));
          }
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [activeChatId, selfId, loadChats, loadUnreadCounters]);

  /** ───────────────  УЧАСТНИКИ АКТИВНОГО ЧАТА + ИМЕНА  ─────────────── */
  const [members, setMembers] = useState([]); // массив user_id
  const [memberNames, setMemberNames] = useState({}); // { user_id: 'Имя' }

  const loadParticipants = useCallback(async (chatId) => {
    if (!chatId) {
      setMembers([]);
      setMemberNames({});
      return;
    }
    // Берём участников через RPC (security definer), чтобы не биться об RLS
    const { data, error } = await supabase.rpc('get_chat_participants', {
      p_chat_id: chatId,
    });
    if (error) {
      console.error('[CHAT] participants rpc error:', error);
      setMembers([]);
      setMemberNames({});
      return;
    }
    const ids = (data || []).map((p) => p.id);
    const dict = {};
    (data || []).forEach((p) => {
      dict[p.id] = p.full_name || '—';
    });
    setMembers(ids);
    setMemberNames(dict);
  }, []);

  useEffect(() => {
    loadParticipants(activeChatId);
  }, [activeChatId, loadParticipants]);

  /** ─────────────────────  СООБЩЕНИЯ / КВИТАНЦИИ  ─────────────────── */
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [receipts, setReceipts] = useState({}); // { [messageId]: { delivered:Set, read:Set } }

  const messagesSubRef = useRef(null);
  const receiptsSubRef = useRef(null);

  // хелпер — получить профиль автора по id
  const fetchAuthor = useCallback(async (authorId) => {
    if (!authorId) return null;
    const { data } = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .eq('id', authorId)
      .single();
    return data || null;
  }, []);

  // батч-дотяжка авторов, если эмбед не сработал
  const backfillAuthors = useCallback(async (rows) => {
    const missingIds = Array.from(
      new Set(rows.filter((r) => !r.author && r.author_id).map((r) => r.author_id)),
    );
    if (!missingIds.length) return rows;

    const { data: profs, error } = await supabase
      .from('profiles')
      .select(PROFILE_FIELDS)
      .in('id', missingIds);

    if (error) {
      console.warn('[CHAT] backfill authors error:', error);
      return rows;
    }

    const map = new Map((profs || []).map((p) => [p.id, p]));
    return rows.map((r) => (r.author ? r : { ...r, author: map.get(r.author_id) || null }));
  }, []);

  const fetchMessages = useCallback(async (chatId) => {
    if (!chatId) return;
    setLoadingMessages(true);

    // Эмбед автора по алиасу внешнего ключа
    const { data, error } = await supabase
      .from('chat_messages')
      .select(
        `
        id, chat_id, author_id, body, file_url, file_name, file_type, file_size, attachment_url, created_at,
        author:profiles!${AUTHOR_FK_ALIAS} ( ${PROFILE_FIELDS} )
      `,
      )
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    setLoadingMessages(false);
    if (error) {
      console.error('[CHAT] messages load error:', error);
      setMessages([]);
      return;
    }

    const withAuthors = await backfillAuthors(data || []);
    setMessages(withAuthors);
  }, [backfillAuthors]);

  // Подписки по активному чату
  useEffect(() => {
    if (!activeChatId) return;

    fetchMessages(activeChatId);
    setReceipts({});

    // отметим чат прочитанным на сервере + локально обнулим бэйдж
    (async () => {
      try {
        await supabase.rpc('mark_chat_read', { p_chat_id: activeChatId });
      } catch (e) {
        console.warn('[CHAT] mark_chat_read error:', e);
      }
    })();
    setUnreadByChat((prev) => ({ ...prev, [activeChatId]: 0 }));

    // Новые сообщения
    if (messagesSubRef.current) supabase.removeChannel(messagesSubRef.current);
    const msgCh = supabase
      .channel(`chat:${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${activeChatId}` },
        async (payload) => {
          const m = payload.new;
          const author = await fetchAuthor(m.author_id); // дотягиваем автора
          setMessages((prev) => [...prev, { ...m, author }]);

          // Входящее → ставим delivered
          if (selfId && m.author_id !== selfId) {
            const row = {
              chat_id: m.chat_id,
              message_id: m.id,
              [RECEIPTS_USER_COLUMN]: selfId,
              status: 'delivered',
            };
            const { error } = await supabase
              .from('message_receipts')
              .upsert([row], {
                onConflict: 'message_id,user_id,status',
                ignoreDuplicates: true,
              });
            if (error) console.warn('[CHAT] deliver upsert error:', error);
          }
        },
      )
      .subscribe();
    messagesSubRef.current = msgCh;

    // Новые квитанции
    if (receiptsSubRef.current) supabase.removeChannel(receiptsSubRef.current);
    const rCh = supabase
      .channel(`receipts:${activeChatId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_receipts', filter: `chat_id=eq.${activeChatId}` },
        (p) => {
          const r = p.new;
          setReceipts((prev) => {
            const obj = { ...prev };
            const entry = obj[r.message_id] || {
              delivered: new Set(),
              read: new Set(),
            };
            const target = r.status === 'read' ? entry.read : entry.delivered;
            target.add(r.user_id);
            obj[r.message_id] = entry;
            return obj;
          });
        },
      )
      .subscribe();
    receiptsSubRef.current = rCh;

    return () => {
      try {
        supabase.removeChannel(msgCh);
      } catch {}
      try {
        supabase.removeChannel(rCh);
      } catch {}
    };
  }, [activeChatId, selfId, fetchMessages, fetchAuthor]);

  // Пометить пачку сообщений прочитанными
  const markReadForMessageIds = useCallback(
    async (ids) => {
      if (!ids?.length || !selfId || !activeChatId) return;

      const rows = ids.map((message_id) => ({
        chat_id: activeChatId,
        message_id,
        [RECEIPTS_USER_COLUMN]: selfId,
        status: 'read',
      }));

      const { error } = await supabase
        .from('message_receipts')
        .upsert(rows, {
          onConflict: 'message_id,user_id,status',
          ignoreDuplicates: true,
        });
      if (error) console.warn('[CHAT] receipts read upsert error:', error);

      try {
        await supabase
          .from('chat_members')
          .update({ last_read_at: new Date().toISOString() })
          .eq('chat_id', activeChatId)
          .eq('member_id', selfId);
      } catch {}
    },
    [activeChatId, selfId],
  );

  /** ─────────────────────  ОТПРАВКА СООБЩЕНИЯ  ───────────────────── */
  const handleSend = useCallback(
    async ({ text, files }) => {
      if (!activeChatId || !selfId) return;

      const f = files?.[0] || null;

      const row = {
        chat_id: activeChatId,
        author_id: selfId,
        body: (text || '').trim() || null,
        // Метаданные файла (аплоад в Storage — опционально, вне этого файла)
        file_url: null,
        file_name: f ? f.name : null,
        file_type: f ? f.type : null,
        file_size: f ? f.size : null,
        attachment_url: null,
      };

      const { error } = await supabase.from('chat_messages').insert(row);
      if (error) {
        console.error('[CHAT] send error:', error);
        alert(error.message || 'Не удалось отправить сообщение');
      }
    },
    [activeChatId, selfId],
  );

  /** ─────────────────────  СУММАРНЫЙ БЕЙДЖ В НАВИГАЦИИ  ───────────── */
  useEffect(() => {
    const total = Object.values(unreadByChat).reduce(
      (s, n) => s + (n || 0),
      0,
    );
    if (typeof window !== 'undefined') {
      localStorage.setItem('CHAT_UNREAD_TOTAL', String(total));
      window.dispatchEvent(
        new CustomEvent('chat-unread-changed', { detail: { total } }),
      );
    }
  }, [unreadByChat]);

  const typingText = useMemo(() => '', []);

  /** ─────────────────────────  РЕНДЕР  ─────────────────────────── */
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        height: 'calc(100vh - 64px)',
        overflow: 'hidden',
      }}
    >
      {/* Шапка активного чата */}
      <div
        style={{
          borderBottom: '1px solid #eee',
          background: '#fff',
          position: 'sticky',
          top: 0,
          zIndex: 2,
        }}
      >
        <ChatHeader
          chat={chats.find((c) => c.chat_id === activeChatId) || null}
          typingText={typingText}
          members={members}
          memberNames={memberNames}
        />
      </div>

      {/* Контент: слева список чатов, справа — сообщения */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', minHeight: 0 }}>
        {/* Список чатов */}
        <div style={{ borderRight: '1px solid #eee', overflow: 'auto' }}>
          <div style={{ padding: '12px' }}>
            <h3 style={{ margin: 0 }}>Чаты</h3>
          </div>
          <ChatList
            chats={chats}
            activeChatId={activeChatId}
            onSelect={setActiveChatId}
            unreadByChat={unreadByChat}
          />
        </div>

        {/* Сообщения и инпут */}
        <div style={{ display: 'grid', gridTemplateRows: '1fr auto', minHeight: 0 }}>
          <div style={{ overflow: 'auto' }}>
            <MessageList
              messages={messages}
              loading={loadingMessages}
              currentUserId={selfId}
              receipts={receipts}
              onMarkVisibleRead={markReadForMessageIds}
              memberNames={memberNames}
            />
          </div>
          <div style={{ borderTop: '1px solid #eee', padding: '10px', background: '#fff' }}>
            <MessageInput
              chatId={activeChatId}
              onSend={handleSend}
              onSent={() => {}}
              canSend={canSend}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
