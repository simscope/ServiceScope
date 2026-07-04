import React, { useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const icons = {
  jobs: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M9 3h6a2 2 0 0 1 2 2v1h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2V5a2 2 0 0 1 2-2Zm0 3h6V5H9v1Zm2 10 5-5-1.4-1.4-3.6 3.6-1.6-1.6L8 13l3 3Z" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h3V2Zm-3 8v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9H4Z" />
    </svg>
  ),
  library: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 3h6a3 3 0 0 1 3 3v15a4 4 0 0 0-3-1H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm10 3a3 3 0 0 1 3-3h3a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-6a4 4 0 0 0-3 1V6Z" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M10 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-9v-2h9V5h-9V3Zm1.7 5.3L15.4 12l-3.7 3.7-1.4-1.4 1.3-1.3H3v-2h8.6l-1.3-1.3 1.4-1.4Z" />
    </svg>
  ),
};

const navItems = [
  { to: '/jobs', label: "Today's Jobs", shortLabel: 'Jobs', icon: icons.jobs, end: true },
  { to: '/calendar', label: 'Calendar', shortLabel: 'Calendar', icon: icons.calendar },
  { to: '/tech-library', label: 'Lib', shortLabel: 'Lib', icon: icons.library },
];

function titleForPath(pathname) {
  if (pathname.startsWith('/calendar')) return 'Calendar';
  if (pathname.startsWith('/tech-library')) return 'Lib';
  if (pathname.startsWith('/jobs/') || pathname.startsWith('/job/')) return 'Job Details';
  return "Today's Jobs";
}

export default function TopNav() {
  const { logout } = useAuth();
  const { pathname } = useLocation();
  const title = useMemo(() => titleForPath(pathname), [pathname]);

  return (
    <>
      <header className="mobile-topbar">
        <div className="mobile-topbar-spacer" />
        <strong>{title}</strong>
        <button className="mobile-icon-button" type="button" onClick={logout} aria-label="Sign out">
          {icons.logout}
        </button>
      </header>

      <nav className="mobile-tabbar" aria-label="Technician app">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
