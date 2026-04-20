import { useQuery, useQueries } from '@tanstack/react-query';
import { Wifi, WifiOff, Shield } from 'lucide-react';
import { apiMikrotikInfo, apiRouters } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton } from '../components/primitives';

export default function Routers() {
  const { data: routers = [], isLoading } = useQuery({
    queryKey: ['routers'],
    queryFn: apiRouters,
    staleTime: 30_000,
  });

  const health = useQueries({
    queries: routers.map((r) => ({
      queryKey: ['mt-info', 'router-card', r.id],
      queryFn: () => apiMikrotikInfo(r.is_default ? null : r.id),
      retry: false,
      enabled: !isLoading && routers.length > 0,
    })),
  });

  return (
    <div>
      <PageHeader
        kicker="Infrastructure"
        title={<>Network <em>routers</em></>}
        subtitle="DB-registered MikroTiks. Choose one in the sidebar to scope live API + bandwidth stream."
      />
      <div className="p-8 space-y-6">
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : !routers.length ? (
          <div className="panel p-8 text-center text-text-mute text-sm">
            No routers in database yet. Use Telegram <code className="text-amber">/addrouter</code> or seed migration.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {routers.map((r, idx) => {
              const q = health[idx];
              const info = q?.data;
              const err = q?.error;
              return (
                <div key={r.id} className="panel p-6 relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber/40 to-transparent" />
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="text-mono text-[10px] text-amber uppercase tracking-[0.2em] mb-1">
                        id {r.id}{r.is_default ? ' · default ★' : ''}
                      </div>
                      <h3 className="text-display text-2xl italic">{r.name}</h3>
                      <div className="text-xs font-mono text-text-mute mt-1">
                        {r.host}:{r.port} · {r.username} · SSL {r.use_ssl ? 'on' : 'off'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {q?.isLoading ? (
                        <span className="led led-warn" />
                      ) : err || !info ? (
                        <>
                          <WifiOff size={16} className="text-red" />
                          <span className="tag tag-red">Unreachable</span>
                        </>
                      ) : (
                        <>
                          <Wifi size={16} className="text-green" />
                          <span className="tag tag-green">REST ok</span>
                        </>
                      )}
                    </div>
                  </div>
                  {info && (
                    <div className="grid grid-cols-2 gap-3 text-xs font-mono border-t border-border-dim pt-4">
                      <Field label="Board">{info.boardName}</Field>
                      <Field label="ROS">{info.version}</Field>
                      <Field label="Uptime" span={2}>{info.uptime}</Field>
                    </div>
                  )}
                  {err && !q?.isLoading && (
                    <p className="text-red text-[11px] font-mono mt-2">{err.response?.data?.error || err.message}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="panel p-6 border-dashed bg-surface2/50">
          <div className="flex items-start gap-3">
            <Shield size={20} className="text-amber mt-0.5" strokeWidth={1.5} />
            <div>
              <div className="text-sm">Add routers from Telegram</div>
              <div className="text-xs text-text-mute mt-1">
                <code className="text-amber">/addrouter</code> — passwords are encrypted (AES-GCM) before storage.
                Default router row uses env <code className="text-text-dim">MIKROTIK_*</code> for REST until you edit the DB host.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, span }) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-text">{children ?? '—'}</div>
    </div>
  );
}
