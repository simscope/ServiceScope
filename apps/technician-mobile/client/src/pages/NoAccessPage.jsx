// client/src/pages/NoAccess.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';

export default function NoAccess() {
  const navigate = useNavigate();

  const goLogin = () => {
    // для HashRouter это станет /#/login
    navigate('/login');
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (_) {
      // игнор
    } finally {
      navigate('/login');
    }
  };

  return (
    <div style={outer}>
      <div style={card}>
        <div style={title}>Нет доступа</div>
        <p style={subtitle}>
          У вас нет прав для просмотра этой страницы. Обратитесь к администратору.
        </p>

        <div style={actions}>
          <button type="button" style={btnPrimary} onClick={goLogin}>
            На страницу входа
          </button>
          <button type="button" style={btnGhost} onClick={logout}>
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}

// --- стили (inline, без отдельного CSS, чтобы точно убрать “чёрные прямоугольники”) ---
const outer = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f8fafc',
  padding: 24,
};

const card = {
  width: '100%',
  maxWidth: 560,
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 16,
  padding: 28,
  boxShadow: '0 10px 25px rgba(2, 6, 23, 0.08)',
  textAlign: 'center',
};

const title = {
  fontSize: 32,
  lineHeight: 1.2,
  fontWeight: 800,
  color: '#0f172a',
  marginBottom: 10,
};

const subtitle = {
  color: '#475569',
  margin: '0 auto 18px',
  maxWidth: 480,
};

const actions = {
  marginTop: 8,
  display: 'flex',
  justifyContent: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

const baseBtn = {
  padding: '10px 16px',
  borderRadius: 10,
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
  outline: 'none',
};

const btnPrimary = {
  ...baseBtn,
  background: '#2563eb',
  color: '#ffffff',
};

const btnGhost = {
  ...baseBtn,
  background: '#ffffff',
  color: '#334155',
  border: '1px solid #cbd5e1',
};
