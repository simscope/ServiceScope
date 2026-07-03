// client/src/pages/ChatAdminPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';

const page   = { padding: 16, display: 'grid', gridTemplateColumns: '420px 1fr', gap: 12 };
const card   = { border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' };
const block  = { ...card, padding: 12 };
const row    = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 8, marginBottom: 8, background: '#fff' };
const h1     = { fontSize: 22, fontWeight: 800, margin: '4px 0 10px' };
const h2     = { fontWeight: 700, fontSize: 16, margin: '8px 0' };
const muted  = { color: '#6b7280' };
const searchBox = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', width: '100%' };
const btn    = { padding: '7px 10px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' };
const primary= { ...btn, background: '#2563eb', color: '#fff', borderColor: '#2563eb' };
const danger = { ...btn, borderColor: '#ef4444', color: '#ef4444' };
const warning= { ...btn, borderColor: '#f59e0b', color: '#b45309' };
const tag    = { display: 'inline-block', padding: '2px 8px', borderRadius: 999, border: '1px solid #e5e7eb', fontSize: 12, background: '#f9fafb' };

const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : '—');
const ORG_ID = 1;

export default function ChatAdminPage() {
  // Сотрудники (важно: берём auth_user_id!)
  const [staff, setStaff] = useState([]);
  // Чаты
  const [chats, setChats] = useState([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [showHidden, setShowHidden] = useState(true);
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  // Участники выбранного чата
  const [members, setMembers] = useState([]); // [{member_id, role, name?}]
  const [membersLoading, setMembersLoading] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [stats, setStats] = useState({ count: 0, lastAt: null });
  // Добавление участников
  const [pickedToAdd, setPickedToAdd] = useState([]); // массив auth_user_id (строкой)
  // Создание чата
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorTitle, setCreatorTitle] = useState('');
  const [creatorPicked, setCreatorPicked] = useState([]); // массив auth_user_id
  const [creatorIsGroup, setCreatorIsGroup] = useState(false);

  // ── сотрудники
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('technicians')
        .select('id,name,is_admin,role,org_id,auth_user_id')
        .eq('org_id', ORG_ID)
        .order('name', { ascending: true });
      if (error) {
        console.warn('[chat-admin] technicians error:', error);
        setStaff([]);
      } else {
        // отфильтруем тех, у кого нет привязки к пользователю
        setStaff((data || []).filter(x => !!x.auth_user_id));
      }
    })();
  }, []);

  // ── список чатов
  useEffect(() => {
    loadChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  const loadChats = async () => {
    setLoadingChats(true);
    const { data, error } = await supabase
      .from('chats')
      .select('id,title,is_group,org_id,created_by,created_at,updated_at,deleted')
      .eq('org_id', ORG_ID);

    if (error) {
      console.error('[chat-admin] chats load error:', error);
      alert(error.message || 'Ошибка загрузки чатов');
      setChats([]);
      setLoadingChats(false);
      return;
    }

    const rows = (data || [])
      .filter((c) => (showHidden ? true : !c.deleted))
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));

    setChats(rows);
    if (!selectedId && rows[0]) setSelectedId(rows[0].id);
    setLoadingChats(false);
  };

  // ── участники + статистика для выбранного чата
  useEffect(() => {
    if (!selectedId) {
      setMembers([]); setNewTitle(''); setStats({ count: 0, lastAt: null });
      return;
    }
    (async () => {
      await Promise.all([loadMembers(selectedId), loadStats(selectedId)]);
      const c = chats.find((x) => x.id === selectedId);
      setNewTitle(c?.title || '');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // NEW: берём member_id/role, потом имена подтягиваем по technicians.auth_user_id
  const loadMembers = async (chatId) => {
    setMembersLoading(true);
    const { data, error } = await supabase
      .from('chat_members')
      .select('member_id, role')
      .eq('chat_id', chatId);

    if (error) {
      console.warn('[chat-admin] loadMembers error:', error);
      setMembers([]);
      setMembersLoading(false);
      return;
    }

    const ids = Array.from(new Set((data || []).map(r => r.member_id).filter(Boolean)));
    let names = {};
    if (ids.length) {
      const { data: tdata } = await supabase
        .from('technicians')
        .select('auth_user_id,name')
        .in('auth_user_id', ids);
      (tdata || []).forEach(t => { names[t.auth_user_id] = t.name; });
    }

    const enriched = (data || []).map(r => ({ ...r, name: names[r.member_id] }));
    // можно отсортировать по имени
    enriched.sort((a,b) => (a.name || a.member_id).localeCompare(b.name || b.member_id));
    setMembers(enriched);
    setMembersLoading(false);
  };

  const loadStats = async (chatId) => {
    const { count } = await supabase
      .from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('chat_id', chatId);

    const { data: last } = await supabase
      .from('chat_messages')
      .select('created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setStats({ count: count ?? 0, lastAt: last?.created_at ?? null });
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return chats;
    return chats.filter((c) => (c.title || '').toLowerCase().includes(s) || String(c.id).includes(s));
  }, [q, chats]);

  const selected = chats.find((c) => c.id === selectedId) || null;

  const toggleHidden = async (chat, toHidden) => {
    const { error } = await supabase.from('chats').update({ deleted: toHidden }).eq('id', chat.id);
    if (error) { console.warn('[chat-admin] toggleHidden error:', error); return alert(error.message || 'Не удалось изменить видимость чата'); }
    await loadChats();
  };

  const renameChat = async () => {
    if (!selected) return;
    const title = (newTitle || '').trim() || null;
    const { error } = await supabase.from('chats').update({ title }).eq('id', selected.id);
    if (error) { console.warn('[chat-admin] rename error:', error); return alert(error.message || 'Не удалось переименовать'); }
    await loadChats();
  };

  const hardDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Удалить чат "${selected.title || selected.id}" вместе с сообщениями и файлами?`)) return;

    const { error: delErr } = await supabase.from('chat_messages').delete().eq('chat_id', selected.id);
    if (delErr) { console.warn('[chat-admin] purge messages error:', delErr); return alert(delErr.message || 'Не удалось удалить сообщения'); }

    const { error } = await supabase.from('chats').delete().eq('id', selected.id);
    if (error) { console.warn('[chat-admin] delete chat error:', error); return alert(error.message || 'Не удалось удалить чат'); }

    setSelectedId(null);
    await loadChats();
  };

  const exportChat = async () => {
    if (!selected) return;
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('chat_id', selected.id)
      .order('created_at', { ascending: true });
    if (error) { console.warn('[chat-admin] export error:', error); return alert(error.message || 'Не удалось выгрузить сообщения'); }
    const blob = new Blob([JSON.stringify(data || [], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat_${selected.id}.json`;
    a.click();
  };

  // Кандидаты = сотрудники, у которых есть auth_user_id, и которых ещё нет в чате
  const candidates = useMemo(() => {
    if (!selected) return [];
    const inChat = new Set(members.map((m) => String(m.member_id)));
    return staff.filter((s) => s.auth_user_id && !inChat.has(String(s.auth_user_id)));
  }, [members, staff, selected]);

  const addMembers = async () => {
    if (!selected || pickedToAdd.length === 0) return;
    const payload = pickedToAdd.map((uid) => ({
      chat_id: selected.id,
      member_id: uid,      // ВАЖНО: это auth.users.id
      role: 'member',
      org_id: ORG_ID,
    }));
    const { error } = await supabase.from('chat_members').insert(payload);
    if (error) {
      console.warn('[chat-admin] addMembers error:', error);
      return alert(error.message || 'Не удалось добавить участников');
    }
    setPickedToAdd([]);
    await loadMembers(selected.id);
  };

  const removeMember = async (memberId) => {
    const admins = members.filter((m) => m.role === 'admin').map((m) => m.member_id);
    if (admins.includes(memberId) && admins.length <= 1) {
      return alert('Нельзя удалить последнего администратора');
    }
    const { error } = await supabase
      .from('chat_members')
      .delete()
      .eq('chat_id', selected.id)
      .eq('member_id', memberId);
    if (error) { console.warn('[chat-admin] removeMember error:', error); return alert(error.message || 'Не удалось удалить участника'); }
    await loadMembers(selected.id);
  };

  const toggleAdmin = async (memberId, makeAdmin) => {
    const admins = members.filter((m) => m.role === 'admin').map((m) => m.member_id);
    if (!makeAdmin && admins.includes(memberId) && admins.length <= 1) {
      return alert('Нельзя снять роль у единственного администратора');
    }
    const { error } = await supabase
      .from('chat_members')
      .update({ role: makeAdmin ? 'admin' : 'member' })
      .eq('chat_id', selected.id)
      .eq('member_id', memberId);
    if (error) { console.warn('[chat-admin] toggleAdmin error:', error); return alert(error.message || 'Не удалось изменить роль'); }
    await loadMembers(selected.id);
  };

  const createChat = async () => {
    const uniq = Array.from(new Set(creatorPicked.map(String)));
    if (uniq.length === 0) return alert('Выберите хотя бы одного участника');

    const { data: userRes, error: uErr } = await supabase.auth.getUser();
    if (uErr || !userRes?.user?.id) return alert('Нет авторизации для создания чата');
    const me = userRes.user.id;

    const isGroup = creatorIsGroup || uniq.length > 1;
    const { data: chat, error } = await supabase
      .from('chats')
      .insert({ title: isGroup ? (creatorTitle || 'Группа') : (creatorTitle || null), is_group: isGroup, org_id: ORG_ID })
      .select('id')
      .single();

    if (error) { console.warn('[chat-admin] createChat error:', error); return alert(error.message || 'Не удалось создать чат'); }

    // Добавляем участников + создателя (все — auth.users.id)
    const allMembers = Array.from(new Set([...uniq, me]));
    const rows = allMembers.map((uid) => ({
      chat_id: chat.id,
      member_id: uid,
      role: 'member',
      org_id: ORG_ID,
    }));
    const { error: mErr } = await supabase.from('chat_members').insert(rows);
    if (mErr) { console.warn('[chat-admin] add members after create error:', mErr); alert('Чат создан, но участников добавить не удалось'); }

    setCreatorOpen(false);
    setCreatorIsGroup(false);
    setCreatorTitle('');
    setCreatorPicked([]);
    await loadChats();
    setSelectedId(chat.id);
  };

  return (
    <div style={page}>
      {/* Левая панель */}
      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 10 }}>
        <div style={block}>
          <div style={h1}>🛠 Администрирование чатов</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <input style={searchBox} placeholder="Поиск по названию или ID…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
              Показывать скрытые чаты
            </label>
            <button style={primary} onClick={() => setCreatorOpen(true)}>＋ Создать новый чат</button>
          </div>
        </div>

        <div style={block}>
          <div style={h2}>Все чаты</div>
          {loadingChats && <div style={muted}>Загрузка…</div>}
          {!loadingChats && filtered.length === 0 && <div style={muted}>Ничего не найдено</div>}

          <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto', paddingRight: 4 }}>
            {filtered.map((c) => (
              <div key={c.id} style={{ ...row, borderColor: selectedId === c.id ? '#c7dcff' : '#e5e7eb' }}>
                <div onClick={() => setSelectedId(c.id)} style={{ cursor: 'pointer' }}>
                  <div style={{ fontWeight: 600 }}>
                    {c.title || <span style={muted}>Без названия</span>}
                    {c.is_group ? <span style={{ ...tag, marginLeft: 8 }}>группа</span> : <span style={{ ...tag, marginLeft: 8 }}>диалог</span>}
                    {c.deleted && <span style={{ ...tag, marginLeft: 8, borderColor: '#f59e0b', background: '#fff7ed' }}>скрыт</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>обновлён: {fmt(c.updated_at)}</div>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  {c.deleted
                    ? <button style={btn} onClick={() => toggleHidden(c, false)}>Показать</button>
                    : <button style={warning} onClick={() => toggleHidden(c, true)}>Скрыть</button>}
                  <button style={danger} onClick={() => { setSelectedId(c.id); hardDelete(); }}>Удалить</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div />
      </div>

      {/* Правая панель */}
      <div style={{ display: 'grid', gap: 10 }}>
        {!selected && <div style={block}><div style={muted}>Выберите чат слева</div></div>}

        {selected && (
          <>
            <div style={block}>
              <div style={h2}>Информация о чате</div>
              <div style={{ display: 'grid', gap: 8 }}>
                <div><b>ID:</b> {selected.id}</div>
                <div><b>Создан:</b> {fmt(selected.created_at)}</div>
                <div><b>Обновлён:</b> {fmt(selected.updated_at)}</div>
                <div><b>Сообщений:</b> {stats.count} {stats.lastAt ? <span style={muted}> • последнее: {fmt(stats.lastAt)}</span> : null}</div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input style={{ ...searchBox, maxWidth: 420 }} placeholder="Название чата (опционально)" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
                  <button style={btn} onClick={renameChat}>Сохранить</button>
                  <button style={warning} onClick={() => hardDelete()}>Удалить чат навсегда</button>
                  <button style={btn} onClick={exportChat}>Экспорт JSON</button>
                </div>
              </div>
            </div>

            <div style={block}>
              <div style={h2}>Участники</div>

              {membersLoading && <div style={muted}>Загрузка…</div>}

              {!membersLoading && (
                <>
                  <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                    {members.map((m) => (
                      <div key={m.member_id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', padding: '6px 4px' }}>
                        <div>
                          <b>{m.name || m.member_id}</b>{' '}
                          {m.role === 'admin' && <span style={{ ...tag, marginLeft: 6 }}>админ</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={btn} onClick={() => toggleAdmin(m.member_id, m.role !== 'admin')}>
                            {m.role === 'admin' ? 'Снять админа' : 'Сделать админом'}
                          </button>
                          <button style={danger} onClick={() => removeMember(m.member_id)}>Удалить</button>
                        </div>
                      </div>
                    ))}
                    {members.length === 0 && <div style={muted}>Нет участников</div>}
                  </div>

                  <div style={{ fontWeight: 600, marginTop: 10 }}>Добавить участников</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'start' }}>
                    <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                      {candidates.map((s) => {
                        const uid = String(s.auth_user_id);
                        const checked = pickedToAdd.includes(uid);
                        return (
                          <label key={uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px' }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setPickedToAdd((prev) => e.target.checked ? [...prev, uid] : prev.filter((x) => x !== uid))
                              }
                            />
                            {s.name} {s.role && s.role !== 'technician' ? `(${s.role})` : ''}
                          </label>
                        );
                      })}
                      {candidates.length === 0 && <div style={muted}>Все сотрудники уже в чате</div>}
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <button style={primary} disabled={pickedToAdd.length === 0} onClick={addMembers}>
                        Добавить выбранных
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Модалка создания */}
      {creatorOpen && (
        <div style={modalWrap} onClick={() => setCreatorOpen(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Создать новый чат</div>

            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={creatorIsGroup} onChange={(e) => setCreatorIsGroup(e.target.checked)} />
                Групповой чат
              </label>

              <input
                style={searchBox}
                placeholder="Название чата (для группы — желательно)"
                value={creatorTitle}
                onChange={(e) => setCreatorTitle(e.target.value)}
              />

              <div style={{ fontWeight: 600, marginTop: 4 }}>Участники</div>
              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                {staff.map((s) => {
                  const uid = String(s.auth_user_id);
                  const checked = creatorPicked.includes(uid);
                  return (
                    <label key={uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setCreatorPicked((prev) => e.target.checked ? [...prev, uid] : prev.filter((x) => x !== uid))
                        }
                      />
                      {s.name} {s.role && s.role !== 'technician' ? `(${s.role})` : ''}
                    </label>
                  );
                })}
                {staff.length === 0 && <div style={muted}>Нет сотрудников</div>}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button style={btn} onClick={() => setCreatorOpen(false)}>Отмена</button>
                <button style={primary} onClick={createChat}>Создать</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const modalWrap = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', display: 'grid', placeItems: 'center', zIndex: 50 };
const modal     = { width: 560, maxWidth: '90vw', background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 10px 24px rgba(0,0,0,.15)' };
