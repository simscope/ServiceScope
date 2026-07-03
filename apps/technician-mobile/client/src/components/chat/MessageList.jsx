// client/src/components/chat/MessageList.jsx
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';

/**
 * props:
 * - messages: Array<{
 *     id, chat_id, author_id, body, file_url, file_name, file_type, file_size,
 *     attachment_url, created_at, author?: { id, full_name, role }
 *   }>
 * - loading: boolean
 * - currentUserId: string | null
 * - receipts: { [messageId]: { delivered: Set<string>, read: Set<string> } }
 * - onMarkVisibleRead: (ids: string[]) => void
 * - memberNames: { [userId]: string }
 */
export default function MessageList({
  messages,
  loading,
  currentUserId,
  receipts,
  onMarkVisibleRead,
  memberNames,
}) {
  const wrapRef = useRef(null);
  const bottomRef = useRef(null);

  // чтобы не слать onMarkVisibleRead несколько раз подряд
  const alreadyMarkedRef = useRef(new Set());

  // ——— форматтер даты
  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'short',
        timeStyle: 'medium',
      }),
    []
  );

  // ——— автоскролл, если мы «почти снизу»
  const isNearBottom = useRef(true);
  const handleScroll = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const delta = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottom.current = delta < 120; // px
  }, []);

  useEffect(() => {
    // при добавлении сообщений прокручиваем, если пользователь внизу
    if (isNearBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages?.length]);

  // ——— наблюдаем за «видимостью» последних N входящих сообщений
  useEffect(() => {
    const root = wrapRef.current;
    if (!root || !messages?.length) return;

    const last = messages.slice(-50); // наблюдаем только «хвост», этого хватает
    const nodes = new Map(); // messageId -> HTMLElement

    // создаём/обновляем DOM-узлы маркеров для наблюдения
    last.forEach((m) => {
      if (m.author_id === currentUserId) return; // свои не отмечаем
      const id = `msg-observe-${m.id}`;
      let anchor = document.getElementById(id);
      if (!anchor) {
        anchor = document.createElement('div');
        anchor.id = id;
        anchor.style.height = '1px';
        anchor.style.width = '100%';
        anchor.style.pointerEvents = 'none';
        const bubble = document.getElementById(`msg-bubble-${m.id}`);
        if (bubble && bubble.parentElement) {
          bubble.parentElement.appendChild(anchor);
        }
      }
      if (anchor) nodes.set(m.id, anchor);
    });

    const io = new IntersectionObserver(
      (entries) => {
        const idsToMark = [];
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          // message id из якоря
          const key = e.target.id.replace('msg-observe-', '');
          if (!alreadyMarkedRef.current.has(key)) {
            alreadyMarkedRef.current.add(key);
            idsToMark.push(key);
          }
        }
        if (idsToMark.length) onMarkVisibleRead?.(idsToMark);
      },
      { root, rootMargin: '0px', threshold: 0.66 }
    );

    nodes.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [messages, currentUserId, onMarkVisibleRead]);

  // ——— помощники
  const getDisplayName = useCallback(
    (m) => {
      const isMe = m.author_id === currentUserId;
      return (
        m.author?.full_name ||
        memberNames?.[m.author_id] ||
        (isMe ? 'Вы' : 'Участник')
      );
    },
    [currentUserId, memberNames]
  );

  const renderStatus = useCallback(
    (m) => {
      // статусы показываем только для своих сообщений
      if (m.author_id !== currentUserId) return null;
      const entry = receipts?.[m.id];
      const delivered = entry?.delivered?.size > 0;
      const read = entry?.read?.size > 0;
      return (
        <span style={{ marginLeft: 8, color: read ? '#2563eb' : '#9ca3af' }}>
          {read ? '✓✓' : delivered ? '✓' : null}
        </span>
      );
    },
    [currentUserId, receipts]
  );

  return (
    <div
      ref={wrapRef}
      onScroll={handleScroll}
      style={{ padding: 12, overflow: 'auto', height: '100%' }}
    >
      {loading && (
        <div style={{ color: '#999', fontSize: 13, padding: '6px 0' }}>
          Загрузка…
        </div>
      )}

      {(messages || []).map((m) => {
        const isMe = m.author_id === currentUserId;
        const name = getDisplayName(m);

        return (
          <div
            key={m.id}
            style={{
              display: 'flex',
              justifyContent: isMe ? 'flex-end' : 'flex-start',
              margin: '8px 0',
            }}
          >
            <div style={{ maxWidth: 640 }}>
              <div
                id={`msg-bubble-${m.id}`}
                style={{
                  display: 'inline-block',
                  background: isMe ? '#e8f0ff' : '#f3f4f6',
                  padding: '8px 10px',
                  borderRadius: 12,
                  boxShadow: '0 1px 2px rgba(0,0,0,.06)',
                  wordBreak: 'break-word',
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: '#6b7280',
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{name}</span>
                  <span>• {fmt.format(new Date(m.created_at))}</span>
                  {renderStatus(m)}
                </div>

                {m.body && (
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 15 }}>
                    {m.body}
                  </div>
                )}

                {m.file_name && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: 8,
                      borderRadius: 8,
                      background: '#fff',
                      border: '1px solid #e5e7eb',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 14,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        background: '#94a3b8',
                        borderRadius: '50%',
                      }}
                    />
                    <span title={m.file_name}>
                      {m.file_name} {m.file_size ? `(${formatBytes(m.file_size)})` : ''}
                    </span>
                    {m.file_url && (
                      <a
                        href={m.file_url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ marginLeft: 6 }}
                      >
                        открыть
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}

/* ================= helpers ================= */

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0,
    num = bytes;
  while (num >= 1024 && i < units.length - 1) {
    num /= 1024;
    i++;
  }
  return `${num.toFixed(num < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
