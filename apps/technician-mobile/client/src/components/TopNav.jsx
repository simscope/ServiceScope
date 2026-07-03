// client/src/components/TopNav.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';

const norm = (r) => {
  if (!r) return null;
  const x = String(r).toLowerCase();
  return x === 'technician' ? 'tech' : x;
};

const GMAIL_FN = 'gmail_list';

const GMAIL_UNREAD_CACHE_KEY = 'GMAIL_UNREAD_COUNT';
const GMAIL_UNREAD_TS_KEY = 'GMAIL_UNREAD_COUNT_TS';
const GMAIL_REFRESH_MS = 5 * 60 * 1000;

const Icon = {
  Jobs: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M9 3h6a2 2 0 0 1 2 2v1h2.5A1.5 1.5 0 0 1 21 7.5v10A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10A1.5 1.5 0 0 1 4.5 6H7V5a2 2 0 0 1 2-2Zm0 3h6V5H9v1Z" />
    </svg>
  ),
  All: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z" />
    </svg>
  ),
  Debtors: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm1 14h-2v-2h2v2Zm0-4h-2V6h2v6Z" />
    </svg>
  ),
  Calendar: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h2V2Zm-3 8v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9H4Z" />
    </svg>
  ),
  Materials: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M12 2 3 6.5V18l9 4 9-4V6.5L12 2Zm0 2.2 6.8 3.2L12 10.6 5.2 7.4 12 4.2ZM5 9.6l7 3.3v6.9l-7-3.1V9.6Zm9 10.2v-6.9l7-3.3v7.1l-7 3.1Z" />
    </svg>
  ),
  Library: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M4 3h6a2 2 0 0 1 2 2v15H6a2 2 0 0 1-2-2V3Zm10 0h4a2 2 0 0 1 2 2v15h-6V5a2 2 0 0 0-2-2h2Zm-8 2v13h6V5H6Zm10 0v13h4V5h-4Z" />
    </svg>
  ),
  Chat: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v15l4-3h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2ZM6 9h8v2H6V9Zm0-4h12v2H6V5Z" />
    </svg>
  ),
  Tasks: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M9 2h6a2 2 0 0 1 2 2v1h3v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5h3V4a2 2 0 0 1 2-2Zm0 3h6V4H9v1Zm-1 5h8v2H8V10Zm0 4h8v2H8v-2Z" />
    </svg>
  ),
  Techs: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4.33 0-8 2-8 4.5V21h16v-2.5C20 16 16.33 14 12 14Z" />
    </svg>
  ),
  Money: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M3 6h18a2 2 0 0 1 2 2v8H1V8a2 2 0 0 1 2-2Zm0 12h18v2H3v-2Zm9-8a3 3 0 1 0 3 3 3 3 0 0 0-3-3Z" />
    </svg>
  ),
  AdminChat: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M2 4a2 2 0 0 1 2-2h10l4 4v6a2 2 0 0 1-2 2H9l-5 4V4Zm18 6h2v8l-5-3h-7v-2h8a2 2 0 0 0 2-2V10Z" />
    </svg>
  ),
  Email: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M3 5h18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm1.2 2 7.8 5.2L19.8 7H4.2Zm16.6 10a.2.2 0 0 0 .2-.2V8.6l-8.2 5.5a1 1 0 0 1-1.1 0L3.6 8.6v8.2a.2.2 0 0 0 .2.2h17z" />
    </svg>
  ),
  Map: (p) => (
    <svg viewBox="0 0 24 24" width="18" height="18" {...p}>
      <path fill="currentColor" d="M9.5 3 3 5.5v15l6.5-2.5L15 21l6-2.5v-15L15 6 9.5 3Zm0 2.2L14 7v11l-4.5-1.8V5.2Zm-2 13.1L5 19.2V7.8l2.5-1v11.5Zm11 0-2.5 1v-11.5l2.5-1v11.5Z" />
    </svg>
  ),
};

const invokeEdge = async (fn, body) => {
  const { data, error } = await supabase.functions.invoke(fn, { body: body || {} });
  if (error) throw error;
  return data;
};

export default function TopNav() {
  const { user, role, logout } = useAuth();
  const uid = user?.id || null;

  const [chatUnreadTotal, setChatUnreadTotal] = useState(() => {
    try {
      const raw = localStorage.getItem('CHAT_UNREAD_TOTAL');
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  });

  const [gmailUnread, setGmailUnread] = useState(() => {
    try {
      const raw = localStorage.getItem(GMAIL_UNREAD_CACHE_KEY);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  });

  const channelRef = useRef(null);
  const debounceRef = useRef(null);
  const pollRef = useRef(null);
  const gmailLoadingRef = useRef(false);
  const gmailLastFetchRef = useRef(0);

  const debounced = (fn, ms = 250) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fn, ms);
  };

  const refreshUnreadFromServer = async () => {
    if (!uid) {
      setChatUnreadTotal(0);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_unread_by_chat');
      if (error) return;

      const sum = (data || []).reduce((s, r) => s + (Number(r.unread) || 0), 0);
      setChatUnreadTotal(sum);

      try {
        localStorage.setItem('CHAT_UNREAD_TOTAL', String(sum));
      } catch {}
    } catch (e) {
      console.error('get_unread_by_chat failed', e);
    }
  };

  const loadGmailUnread = async ({ force = false } = {}) => {
    if (!user) {
      setGmailUnread(0);
      return;
    }

    if (gmailLoadingRef.current) return;

    const now = Date.now();
    const lastTs = Number(localStorage.getItem(GMAIL_UNREAD_TS_KEY) || 0);

    if (!force && lastTs && now - lastTs < GMAIL_REFRESH_MS) {
      return;
    }

    gmailLoadingRef.current = true;
    gmailLastFetchRef.current = now;

    try {
      const json = await invokeEdge(GMAIL_FN, {
        folder: 'inbox',
        q: 'is:unread',
        maxResults: 1,
      });

      const count = json && json.ok && Array.isArray(json.emails) ? json.emails.length : 0;

      setGmailUnread(count);

      try {
        localStorage.setItem(GMAIL_UNREAD_CACHE_KEY, String(count));
        localStorage.setItem(GMAIL_UNREAD_TS_KEY, String(Date.now()));
      } catch {}
    } catch (e) {
      console.error('gmail_list unread failed', e);
      setGmailUnread(0);
    } finally {
      gmailLoadingRef.current = false;
    }
  };

  useEffect(() => {
    const onLocalChanged = (e) => {
      const n = e?.detail?.total;
      if (typeof n === 'number') setChatUnreadTotal(n);
    };

    window.addEventListener('chat-unread-changed', onLocalChanged);

    return () => {
      window.removeEventListener('chat-unread-changed', onLocalChanged);
    };
  }, []);

  useEffect(() => {
    if (channelRef.current) {
      try {
        supabase.removeChannel(channelRef.current);
      } catch {}
      channelRef.current = null;
    }

    clearInterval(pollRef.current);

    if (!uid) return;

    refreshUnreadFromServer();

    const ch = supabase
      .channel('topnav-unread')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => debounced(refreshUnreadFromServer),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_members',
          filter: `member_id=eq.${uid}`,
        },
        () => debounced(refreshUnreadFromServer),
      )
      .subscribe();

    channelRef.current = ch;

    const onFocus = () => debounced(refreshUnreadFromServer, 50);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        onFocus();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    pollRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshUnreadFromServer();
      }
    }, 30000);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(pollRef.current);

      try {
        if (channelRef.current) supabase.removeChannel(channelRef.current);
      } catch {}

      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    if (!user) {
      setGmailUnread(0);
      return;
    }

    loadGmailUnread({ force: false });

    const onFocus = () => {
      loadGmailUnread({ force: false });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadGmailUnread({ force: false });
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const r = useMemo(() => norm(role), [role]);

  const base = process.env.PUBLIC_URL || '';
  const [logoSrc, setLogoSrc] = useState(`${base}/logo_invoice_header.png`);
  const [triedFallback, setTriedFallback] = useState(false);

  const onLogoError = () => {
    if (!triedFallback) {
      setLogoSrc(`${base}/logo192.png`);
      setTriedFallback(true);
    } else {
      setLogoSrc(null);
    }
  };

  const links = useMemo(() => {
    const arr = [{ to: '/jobs', label: 'Заявки', icon: <Icon.Jobs />, end: true }];

    if (r === 'admin' || r === 'manager') {
      arr.push(
        { to: '/jobs/all', label: 'Все заявки', icon: <Icon.All /> },
        { to: '/debtors', label: 'Должники', icon: <Icon.Debtors /> },
        { to: '/calendar', label: 'Календарь', icon: <Icon.Calendar /> },
        { to: '/materials', label: 'Материалы', icon: <Icon.Materials /> },
        { to: '/tasks/today', label: 'Задачи', icon: <Icon.Tasks /> },
        { to: '/map', label: 'Карта', icon: <Icon.Map /> },
        { to: '/email', label: 'Email', icon: <Icon.Email /> },
        { to: '/chat', label: 'Чат', icon: <Icon.Chat /> },
      );
    }

    if (r === 'admin') {
      arr.push(
        { to: '/technicians', label: 'Техники', icon: <Icon.Techs /> },
        { to: '/finance', label: 'Финансы', icon: <Icon.Money /> },
        { to: '/chat-admin', label: 'Чат (админ)', icon: <Icon.AdminChat /> },
      );
    }

    if (r === 'admin' || r === 'manager') {
      arr.push({ to: '/tech-library', label: 'Тех. база', icon: <Icon.Library /> });
    }

    return arr;
  }, [r]);

  const initials = useMemo(() => {
    const name = (user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || '').trim();
    if (!name) return 'U';

    const parts = name.split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  }, [user]);

  if (!user) return null;

  return (
    <header className="tn">
      <div className="tn__left">
        {logoSrc && (
          <img
            src={logoSrc}
            alt="Sim Scope"
            className="tn__logo"
            onError={onLogoError}
            loading="eager"
            decoding="async"
          />
        )}

        <span className="tn__brand">Sim&nbsp;Scope</span>

        <nav className="tn__nav">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => 'tn__link' + (isActive ? ' is-active' : '')}
              aria-label={`${l.label}${
                l.to === '/chat' && chatUnreadTotal ? `, ${chatUnreadTotal} непрочитанных` : ''
              }${l.to === '/email' && gmailUnread ? `, ${gmailUnread} новых писем` : ''}`}
            >
              <span className="tn__icon">{l.icon}</span>
              <span className="tn__text">{l.label}</span>

              {l.to === '/chat' && chatUnreadTotal > 0 && (
                <span className="tn__badge" aria-hidden="true">
                  {chatUnreadTotal > 99 ? '99+' : chatUnreadTotal}
                </span>
              )}

              {l.to === '/email' && gmailUnread > 0 && (
                <span className="tn__badge tn__badge--email" aria-hidden="true">
                  {gmailUnread > 99 ? '99+' : gmailUnread}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="tn__right">
        <span className={`tn__role tn__role--${r || 'none'}`}>{r || '...'}</span>

        <div className="tn__avatar" title={user?.email || ''}>
          {initials}
        </div>

        <button className="tn__btn" onClick={logout}>
          Выйти
        </button>
      </div>

      <style>{`
        :root {
          --tn-bg: linear-gradient(90deg, #0f172a 0%, #111827 50%, #1f2937 100%);
          --tn-fg: #e5e7eb;
          --tn-pill: rgba(255,255,255,0.08);
          --tn-pill-active: rgba(59,130,246,0.22);
          --tn-border: rgba(255,255,255,0.08);
          --tn-accent: #60a5fa;
        }

        .tn {
          position: sticky;
          top: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          background: var(--tn-bg);
          color: var(--tn-fg);
          border-bottom: 1px solid var(--tn-border);
          box-shadow: 0 6px 24px rgba(0,0,0,.25);
        }

        .tn__left {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .tn__logo {
          width: 28px;
          height: 28px;
          object-fit: contain;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,.4));
        }

        .tn__brand {
          font-weight: 800;
          letter-spacing: .2px;
          margin-right: 6px;
          white-space: nowrap;
        }

        .tn__nav {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .tn__link {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--tn-fg);
          text-decoration: none;
          padding: 8px 10px;
          border-radius: 999px;
          background: var(--tn-pill);
          border: 1px solid transparent;
          transition: all .15s ease;
        }

        .tn__link:hover {
          transform: translateY(-1px);
          border-color: var(--tn-border);
        }

        .tn__link.is-active {
          background: var(--tn-pill-active);
          border-color: rgba(96,165,250,.35);
        }

        .tn__icon {
          display: grid;
          place-items: center;
          color: var(--tn-accent);
        }

        .tn__text {
          font-size: 14px;
        }

        .tn__badge {
          background: #ef4444;
          color: #fff;
          border-radius: 9999px;
          padding: 0 8px;
          min-width: 20px;
          height: 20px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          line-height: 20px;
          user-select: none;
          margin-left: 6px;
          box-shadow: 0 1px 2px rgba(0,0,0,.25);
        }

        .tn__badge--email {
          background: #2563eb;
        }

        .tn__right {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .tn__role {
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: .5px;
          padding: 4px 8px;
          border-radius: 8px;
          background: var(--tn-pill);
          border: 1px solid var(--tn-border);
        }

        .tn__role--admin {
          background: rgba(220,38,38,.18);
          border-color: rgba(220,38,38,.28);
        }

        .tn__role--manager {
          background: rgba(234,179,8,.18);
          border-color: rgba(234,179,8,.28);
        }

        .tn__role--tech {
          background: rgba(34,197,94,.18);
          border-color: rgba(34,197,94,.28);
        }

        .tn__avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-weight: 700;
          background: #0ea5e9;
          color: white;
          box-shadow: inset 0 0 0 2px rgba(255,255,255,.35);
        }

        .tn__btn {
          border: 1px solid var(--tn-border);
          color: var(--tn-fg);
          background: rgba(255,255,255,0.04);
          border-radius: 10px;
          padding: 6px 10px;
          cursor: pointer;
        }

        .tn__btn:hover {
          background: rgba(255,255,255,0.08);
        }

        @media (max-width: 980px) {
          .tn__text {
            display: none;
          }

          .tn__brand {
            display: none;
          }
        }
      `}</style>
    </header>
  );
}
