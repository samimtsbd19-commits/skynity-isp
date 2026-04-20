import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, Download, CheckCircle2, Power, Package as PackageIcon, AlertCircle,
} from 'lucide-react';
import {
  apiUpdateCheck, apiUpdateDownload, apiUpdateInstall, apiRouterReboot,
  apiRouterPackages, apiRouterPackageToggle, apiUpdateTasks, apiRouters,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton, EmptyState, ConfirmButton } from '../components/primitives';
import { useSelectedRouter } from '../contexts/RouterContext';

export default function Updates() {
  const qc = useQueryClient();
  const { routerId: ctxRouterId } = useSelectedRouter();
  const { data: routers = [] } = useQuery({ queryKey: ['routers'], queryFn: apiRouters });
  const [selectedId, setSelectedId] = useState('');
  const routerId = Number(selectedId) || ctxRouterId || routers?.[0]?.id;

  const { data: packages = [], isLoading: pkgLoading } = useQuery({
    queryKey: ['updates.packages', routerId],
    queryFn: () => apiRouterPackages(routerId),
    enabled: !!routerId,
    retry: 0,
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['updates.tasks', routerId],
    queryFn: () => apiUpdateTasks(routerId),
    enabled: !!routerId,
    refetchInterval: 10_000,
  });

  const check = useMutation({
    mutationFn: () => apiUpdateCheck(routerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['updates.tasks', routerId] }),
  });
  const dl = useMutation({
    mutationFn: () => apiUpdateDownload(routerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['updates.tasks', routerId] }),
  });
  const install = useMutation({
    mutationFn: () => apiUpdateInstall(routerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['updates.tasks', routerId] }),
  });
  const reboot = useMutation({
    mutationFn: () => apiRouterReboot(routerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['updates.tasks', routerId] }),
  });
  const togglePkg = useMutation({
    mutationFn: ({ id, enabled }) => apiRouterPackageToggle(routerId, id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['updates.packages', routerId] }),
  });

  const latestCheck = tasks.find((t) => t.action === 'check' && t.status === 'success');

  return (
    <div>
      <PageHeader
        kicker="Maintenance"
        title={<>RouterOS <em>updates</em></>}
        subtitle="Check / download / install RouterOS firmware and manage packages per router."
      />
      <div className="p-8 grid gap-6">
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Active router</div>
              <select
                className="input mt-1.5 w-80"
                value={selectedId || routerId || ''}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {routers.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} · {r.host}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={() => check.mutate()} disabled={!routerId || check.isPending}>
                <RefreshCw size={13} /> Check
              </button>
              <button className="btn btn-ghost" onClick={() => dl.mutate()} disabled={!routerId || dl.isPending}>
                <Download size={13} /> Download
              </button>
              <ConfirmButton variant="danger" confirmText="Install + auto-reboot?" onConfirm={() => install.mutate()}>
                <CheckCircle2 size={13} /> Install
              </ConfirmButton>
              <ConfirmButton variant="danger" confirmText="Reboot now?" onConfirm={() => reboot.mutate()}>
                <Power size={13} /> Reboot
              </ConfirmButton>
            </div>
          </div>
          {latestCheck && (
            <div className="mt-2 text-xs font-mono text-text-mute">
              Last check: <span className="text-text-dim">{new Date(latestCheck.finished_at).toLocaleString()}</span>
              {latestCheck.installed_version && <> · Installed <span className="text-text-dim">{latestCheck.installed_version}</span></>}
              {latestCheck.latest_version && <> · Latest <span className="text-amber">{latestCheck.latest_version}</span></>}
            </div>
          )}
        </div>

        <section>
          <h2 className="text-display text-xl italic mb-3">Packages</h2>
          {pkgLoading ? (
            <Skeleton className="h-16" />
          ) : !packages.length ? (
            <div className="panel"><EmptyState title="No packages returned" icon={PackageIcon} hint="Router might be offline or REST disabled." /></div>
          ) : (
            <div className="panel">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="border-b border-border-dim text-text-mute">
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">Version</th>
                    <th className="text-left px-3 py-2">Build time</th>
                    <th className="text-left px-3 py-2">State</th>
                    <th className="text-right px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.map((p) => (
                    <tr key={p['.id']} className="border-b border-border-dim">
                      <td className="px-3 py-2 text-text">{p.name}</td>
                      <td className="px-3 py-2 text-text-dim">{p.version}</td>
                      <td className="px-3 py-2 text-text-mute">{p['build-time']}</td>
                      <td className="px-3 py-2">
                        {p.disabled === 'true'
                          ? <span className="tag tag-dim">disabled</span>
                          : <span className="tag tag-green">enabled</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          className="btn btn-ghost"
                          onClick={() => togglePkg.mutate({ id: p['.id'], enabled: p.disabled === 'true' })}
                        >
                          {p.disabled === 'true' ? 'Enable' : 'Disable'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-display text-xl italic mb-3">Task history</h2>
          <div className="panel">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border-dim text-text-mute">
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Action</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-b border-border-dim">
                    <td className="px-3 py-2 text-text-dim">{new Date(t.started_at).toLocaleString()}</td>
                    <td className="px-3 py-2">{t.action}</td>
                    <td className="px-3 py-2">
                      <span className={`tag ${t.status === 'success' ? 'tag-green' : t.status === 'failed' ? 'tag-red' : 'tag-amber'}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-mute truncate max-w-[400px]">
                      {t.error_message ? (
                        <span className="text-red"><AlertCircle size={11} className="inline mr-1" />{t.error_message}</span>
                      ) : (
                        t.latest_version ? `v${t.installed_version} → v${t.latest_version}` : (t.package_name || '')
                      )}
                    </td>
                  </tr>
                ))}
                {!tasks.length && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-text-mute">No tasks yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
