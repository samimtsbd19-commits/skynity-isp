import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRouters } from '../api/client';

const RouterCtx = createContext(null);

const STORAGE_KEY = 'skynity_router_id';

export function RouterProvider({ children }) {
  const [routerId, setRouterIdState] = useState(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s == null || s === '' || s === 'default') return null;
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  });

  const { data: routers = [], isLoading } = useQuery({
    queryKey: ['routers'],
    queryFn: apiRouters,
    staleTime: 60_000,
  });

  const setRouterId = useCallback((id) => {
    setRouterIdState(id);
    try {
      if (id == null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(id));
    } catch { /* ignore */ }
  }, []);

  const value = useMemo(
    () => ({
      routerId,
      setRouterId,
      routers,
      routersLoading: isLoading,
    }),
    [routerId, setRouterId, routers, isLoading]
  );

  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>;
}

export function useSelectedRouter() {
  const ctx = useContext(RouterCtx);
  if (!ctx) throw new Error('useSelectedRouter outside RouterProvider');
  return ctx;
}
