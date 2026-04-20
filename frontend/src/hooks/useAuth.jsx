import { createContext, useContext, useEffect, useState } from 'react';
import { apiLogin, apiMe } from '../api/client';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(() => {
    try { return JSON.parse(localStorage.getItem('skynity_admin') || 'null'); }
    catch { return null; }
  });
  const [loading, setLoading] = useState(false);

  // on mount, verify token if we have one
  useEffect(() => {
    const t = localStorage.getItem('skynity_token');
    if (!t) return;
    apiMe()
      .then((me) => {
        setAdmin(me);
        localStorage.setItem('skynity_admin', JSON.stringify(me));
      })
      .catch(() => {
        localStorage.removeItem('skynity_token');
        localStorage.removeItem('skynity_admin');
        setAdmin(null);
      });
  }, []);

  const login = async (u, p) => {
    setLoading(true);
    try {
      const { token, admin } = await apiLogin(u, p);
      localStorage.setItem('skynity_token', token);
      localStorage.setItem('skynity_admin', JSON.stringify(admin));
      setAdmin(admin);
      return admin;
    } finally { setLoading(false); }
  };

  const logout = () => {
    localStorage.removeItem('skynity_token');
    localStorage.removeItem('skynity_admin');
    setAdmin(null);
    window.location.href = '/login';
  };

  return (
    <AuthCtx.Provider value={{ admin, login, logout, loading }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
