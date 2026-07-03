// client/src/components/chat/ChatList.jsx
import React from 'react';

function formatWhen(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString();
}

const GroupIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M16 11a4 4 0 1 0-4-4a4 4 0 0 0 4 4m-8 1a4 4 0 1 0-4-4a4 4 0 0 0 4 4m0 2c-3.33 0-8 1.67-8 5v3h10v-3c0-1.61.73-2.86 1.86-3.8A11.41 11.41 0 0 0 8 14m8 0a7.23 7.23 0 0 0-2.77.55A6 6 0 0 1 18 20v3h6v-3c0-3.33-4.67-5-8-5Z"
    />
  </svg>
);

export default function ChatList({
  chats = [],              // [{ chat_id, title, is_group, last_at }]
  activeChatId,
  onSelect,
  unreadByChat = {},       // { [chat_id]: number }
}) {
  const items = Array.isArray(chats) ? chats : [];

  return (
    <div>
      {items.length === 0 && (
        <div style={{ padding: 12, color: '#888' }}>Чатов пока нет</div>
      )}

      {items.map((c) => {
        const unread = unreadByChat[c.chat_id] || 0;
        const active = c.chat_id === activeChatId;
        const when = formatWhen(c.last_at);

        const handleActivate = () => onSelect?.(c.chat_id);
        const onKeyDown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleActivate();
          }
        };

        return (
          <div
            key={c.chat_id}
            onClick={handleActivate}
            onKeyDown={onKeyDown}
            role="button"
            tabIndex={0}
            style={{
              cursor: 'pointer',
              padding: '10px 12px',
              background: active ? '#eef2ff' : '#fff',
              borderBottom: '1px solid #f3f4f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
            aria-current={active ? 'true' : undefined}
            aria-label={`${c.title || 'Без названия'}${unread ? `, ${unread} непрочитанных` : ''}`}
            title={c.title || 'Без названия'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {c.is_group ? (
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 9999,
                    background: '#e5e7eb',
                    color: '#6b7280',
                    display: 'grid',
                    placeItems: 'center',
                    flex: '0 0 24px',
                  }}
                >
                  <GroupIcon />
                </div>
              ) : (
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 9999,
                    background: '#dbeafe',
                    color: '#1d4ed8',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 12,
                    fontWeight: 700,
                    flex: '0 0 24px',
                  }}
                >
                  {(c.title || 'Чат').trim().slice(0, 1).toUpperCase()}
                </div>
              )}

              <div style={{ overflow: 'hidden' }}>
                <div
                  style={{
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {c.title || 'Без названия'}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>{when}</div>
              </div>
            </div>

            {unread > 0 && (
              <span
                aria-label={`${unread} непрочитанных`}
                style={{
                  background: '#ef4444',
                  color: '#fff',
                  borderRadius: 9999,
                  padding: '2px 8px',
                  fontSize: 12,
                  fontWeight: 700,
                  minWidth: 22,
                  textAlign: 'center',
                  userSelect: 'none',
                }}
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
