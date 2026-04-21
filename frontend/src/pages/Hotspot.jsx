import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wifi, Users, Layers, Monitor, FileText, Lock, Unlock, UserX, UserCheck, Trash2, Plus, RefreshCw, X, Check } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { StatusPill, EmptyState, Skeleton } from '../components/primitives';
import { useSelectedRouter } from '../contexts/RouterContext';
import {
  apiHotspotActive, apiHotspotKick,
  apiHotspotUsers, apiHotspotUserCreate, apiHotspotUserDelete, apiHotspotUserEnable, apiHotspotUserDisable,
  apiHotspotProfiles, apiHotspotProfileCreate, apiHotspotProfileDelete,
  apiHotspotHosts, apiHotspotLog,
  apiHotspotServers, apiHotspotServerLock,
} from '../api/client';

const TABS = [
  { key: 'active',   label: 'Active',    icon: Monitor },
  { key: 'users',    label: 'Users',     icon: Users },
  { key: 'profiles', label: 'Profiles',  icon: Layers },
  { key: 'hosts',    label: 'Hosts',     icon: Wifi },
  { key: 'log',      label: 'Log',       icon: FileText },
];

export default function Hotspot() {
  const [tab, setTab] = useState('active');
  const { routerId } = useSelectedRouter();

  return (
    <div>
      <PageHeader
        kicker="Network"
        title={<>Hotspot <em>Management</em></>}
        subtitle="Manage active sessions, users, profiles, hosts and logs."
      />
      <div className="px-8 py-6">
        {/* Tab bar */}
        <div className="flex items-center gap-1 mb-6 border-b border-border-dim pb-4 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors rounded-sm whitespace-nowrap ${
                tab === t.key ? 'bg-amber text-black' : 'text-text-dim hover:text-text hover:bg-surface2'
              }`}
            >
              <t.icon size={12} />
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'active'   && <ActiveTab routerId={routerId} />}
        {tab === 'users'    && <UsersTab routerId={routerId} />}
        {tab === 'profiles' && <ProfilesTab routerId={routerId} />}
        {tab === 'hosts'    && <HostsTab routerId={routerId} />}
        {tab === 'log'      && <LogTab routerId={routerId} />}
      </div>
    </div>
  );
}

// ── Active Sessions ───────────────────────────────────────────
function ActiveTab({ routerId }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['hotspot-active', routerId],
    queryFn: () => apiHotspotActive(routerId),
    refetchInterval: 15_000,
  });

  const { data: servers } = useQuery({
    queryKey: ['hotspot-servers', routerId],
    queryFn: () => apiHotspotServers(routerId),
  });

  const kick = useMutation({
    mutationFn: (id) => apiHotspotKick(id, routerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hotspot-active'] }),
  });

  const lock = useMutation({
    mutationFn: ({ id, locked }) => apiHotspotServerLock(id, locked, routerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hotspot-servers'] }),
  });

  const list = data || [];

  return (
    <div className="space-y-4">
      {/* Server lock controls */}
      {servers?.length > 0 && (
        <div className="panel p-4">
          <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider mb-3">Hotspot Servers</div>
          <div className="flex flex-wrap gap-3">
            {servers.map((s) => (
              <div key={s['.id']} className="flex items-center gap-3 bg-surface2 rounded px-3 py-2 text-sm">
                <span className={`led ${s.disabled === 'false' || !s.disabled ? 'led-on' : 'led-off'}`} />
                <span className="font-mono text-xs">{s.name}</span>
                <span className="text-text-mute text-xs">{s.interface}</span>
                <button
                  onClick={() => lock.mutate({ id: s['.id'], locked: s.disabled !== 'true' })}
                  disabled={lock.isPending}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded font-mono ${
                    s.disabled === 'true' ? 'text-green hover:text-black hover:bg-green' : 'text-amber hover:text-black hover:bg-amber'
                  } transition-colors`}
                >
                  {s.disabled === 'true' ? <><Unlock size={11} /> Unlock</> : <><Lock size={11} /> Lock</>}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active sessions table */}
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-dim">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">
            Active Sessions <span className="text-amber ml-1">{list.length}</span>
          </span>
          <button onClick={() => refetch()} className="text-text-mute hover:text-amber transition-colors">
            <RefreshCw size={13} />
          </button>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
        ) : !list.length ? (
          <EmptyState title="No active hotspot sessions" hint="Sessions appear here when users log in." icon={Monitor} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-dim">
                  {['User','MAC','IP','Uptime','Idle','Bytes In','Bytes Out',''].map(h => (
                    <th key={h} className="text-left px-4 py-2 text-mono text-[10px] text-text-mute uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s['.id']} className="border-b border-border-dim last:border-0 hover:bg-surface2/30">
                    <td className="px-4 py-3 font-mono text-xs text-amber">{s.user}</td>
                    <td className="px-4 py-3 font-mono text-xs text-text-dim">{s['mac-address']}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.address}</td>
                    <td className="px-4 py-3 font-mono text-xs text-green">{s.uptime}</td>
                    <td className="px-4 py-3 font-mono text-xs text-text-mute">{s['idle-time'] || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{fmtBytes(s['bytes-in'])}</td>
                    <td className="px-4 py-3 font-mono text-xs">{fmtBytes(s['bytes-out'])}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => kick.mutate(s['.id'])}
                        disabled={kick.isPending}
                        className="text-xs font-mono text-red hover:bg-red/10 px-2 py-1 rounded transition-colors flex items-center gap-1"
                      >
                        <UserX size={11} /> Kick
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Users ─────────────────────────────────────────────────────
function UsersTab({ routerId }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['hotspot-users', routerId],
    queryFn: () => apiHotspotUsers(routerId),
  });

  const del = useMutation({
    mutationFn: (id) => apiHotspotUserDelete(id, routerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hotspot-users'] }),
  });
  const enable = useMutation({
    mutationFn: (id) => apiHotspotUserEnable(id, routerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hotspot-users'] }),
  });
  const disable = useMutation({
    mutationFn: (id) => apiHotspotUserDisable(id, routerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hotspot-users'] }),
  });

  const list = data || [];

  return (
    <div className="space-y-4">
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-dim">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">
            Hotspot Users <span className="text-amber ml-1">{list.length}</span>
          </span>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 text-xs font-mono text-green hover:text-amber transition-colors">
            <Plus size={12} /> Add User
          </button>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
        ) : !list.length ? (
          <EmptyState title="No hotspot users" hint="Add a user to get started." icon={Users} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-dim">
                  {['User','Profile','MAC','Comment','Status',''].map(h => (
                    <th key={h} className="text-left px-4 py-2 text-mono text-[10px] text-text-mute uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((u) => {
                  const disabled = u.disabled === 'true';
                  return (
                    <tr key={u['.id']} className="border-b border-border-dim last:border-0 hover:bg-surface2/30">
                      <td className="px-4 py-3 font-mono text-xs text-amber">{u.name}</td>
                      <td className="px-4 py-3 font-mono text-xs">{u.profile}</td>
                      <td className="px-4 py-3 font-mono text-xs text-text-dim">{u['mac-address'] || '—'}</td>
                      <td className="px-4 py-3 text-xs text-text-mute truncate max-w-[160px]">{u.comment || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`tag ${disabled ? 'tag-dim' : 'tag-success'}`}>{disabled ? 'disabled' : 'active'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => disabled ? enable.mutate(u['.id']) : disable.mutate(u['.id'])}
                            className={`text-xs font-mono px-2 py-1 rounded transition-colors flex items-center gap-1 ${
                              disabled ? 'text-green hover:bg-green/10' : 'text-amber hover:bg-amber/10'
                            }`}
                          >
                            {disabled ? <><UserCheck size={11} /> Enable</> : <><UserX size={11} /> Disable</>}
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete user "${u.name}"?`)) del.mutate(u['.id']); }}
                            className="text-xs font-mono text-red hover:bg-red/10 px-2 py-1 rounded transition-colors"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <AddUserModal
          routerId={routerId}
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['hotspot-users'] }); }}
        />
      )}
    </div>
  );
}

function AddUserModal({ routerId, onClose, onSuccess }) {
  const [form, setForm] = useState({ name: '', password: '', profile: 'default', comment: '', mac_address: '' });
  const { data: profiles } = useQuery({ queryKey: ['hotspot-profiles', routerId], queryFn: () => apiHotspotProfiles(routerId) });

  const create = useMutation({
    mutationFn: () => apiHotspotUserCreate(form, routerId),
    onSuccess,
  });

  return (
    <Modal title="Add Hotspot User" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Username" required>
          <input className="input input-sm w-full" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="username" />
        </Field>
        <Field label="Password">
          <input className="input input-sm w-full" type="password" value={form.password} onChange={e => setForm(f => ({...f, password: e.target.value}))} placeholder="leave blank = no password" />
        </Field>
        <Field label="Profile">
          <select className="input input-sm w-full" value={form.profile} onChange={e => setForm(f => ({...f, profile: e.target.value}))}>
            <option value="default">default</option>
            {(profiles || []).filter(p => p.name !== 'default').map(p => (
              <option key={p['.id']} value={p.name}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="MAC Address (optional)">
          <input className="input input-sm w-full" value={form.mac_address} onChange={e => setForm(f => ({...f, mac_address: e.target.value}))} placeholder="XX:XX:XX:XX:XX:XX" />
        </Field>
        <Field label="Comment">
          <input className="input input-sm w-full" value={form.comment} onChange={e => setForm(f => ({...f, comment: e.target.value}))} placeholder="optional note" />
        </Field>
        {create.isError && <div className="text-xs text-red font-mono">{create.error?.response?.data?.error || create.error?.message}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-border-dim">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!form.name || create.isPending} className="btn btn-primary">
            <Plus size={13} /> {create.isPending ? 'Adding…' : 'Add User'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Profiles ──────────────────────────────────────────────────
function ProfilesTab({ routerId }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['hotspot-profiles', routerId],
    queryFn: () => apiHotspotProfiles(routerId),
  });

  const del = useMutation({
    mutationFn: (id) => apiHotspotProfileDelete(id, routerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hotspot-profiles'] }),
  });

  const list = data || [];

  return (
    <div className="space-y-4">
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-dim">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">User Profiles <span className="text-amber ml-1">{list.length}</span></span>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 text-xs font-mono text-green hover:text-amber transition-colors">
            <Plus size={12} /> Add Profile
          </button>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
        ) : !list.length ? (
          <EmptyState title="No profiles" icon={Layers} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-dim">
                  {['Name','Rate Limit','Session Timeout','Shared Users',''].map(h => (
                    <th key={h} className="text-left px-4 py-2 text-mono text-[10px] text-text-mute uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p['.id']} className="border-b border-border-dim last:border-0 hover:bg-surface2/30">
                    <td className="px-4 py-3 font-mono text-xs text-amber">{p.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p['rate-limit'] || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p['session-timeout'] || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p['shared-users'] || '1'}</td>
                    <td className="px-4 py-3 text-right">
                      {p.name !== 'default' && (
                        <button onClick={() => { if (confirm(`Delete profile "${p.name}"?`)) del.mutate(p['.id']); }}
                          className="text-xs font-mono text-red hover:bg-red/10 px-2 py-1 rounded">
                          <Trash2 size={11} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && (
        <AddProfileModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['hotspot-profiles'] }); }}
          routerId={routerId}
        />
      )}
    </div>
  );
}

function AddProfileModal({ routerId, onClose, onSuccess }) {
  const [form, setForm] = useState({ name: '', rate_limit: '', session_timeout: '', shared_users: '1' });

  const create = useMutation({
    mutationFn: () => apiHotspotProfileCreate(form, routerId),
    onSuccess,
  });

  return (
    <Modal title="Add User Profile" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Profile Name" required>
          <input className="input input-sm w-full" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="e.g. 5mbps-plan" />
        </Field>
        <Field label="Rate Limit">
          <input className="input input-sm w-full" value={form.rate_limit} onChange={e => setForm(f => ({...f, rate_limit: e.target.value}))} placeholder="e.g. 5M/5M" />
        </Field>
        <Field label="Session Timeout">
          <input className="input input-sm w-full" value={form.session_timeout} onChange={e => setForm(f => ({...f, session_timeout: e.target.value}))} placeholder="e.g. 30d or 00:00:00" />
        </Field>
        <Field label="Shared Users">
          <input className="input input-sm w-full" type="number" min="1" value={form.shared_users} onChange={e => setForm(f => ({...f, shared_users: e.target.value}))} />
        </Field>
        {create.isError && <div className="text-xs text-red font-mono">{create.error?.response?.data?.error || create.error?.message}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t border-border-dim">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={() => create.mutate()} disabled={!form.name || create.isPending} className="btn btn-primary">
            <Plus size={13} /> {create.isPending ? 'Adding…' : 'Add Profile'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Hosts ─────────────────────────────────────────────────────
function HostsTab({ routerId }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['hotspot-hosts', routerId],
    queryFn: () => apiHotspotHosts(routerId),
    refetchInterval: 30_000,
  });

  const list = data || [];

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border-dim">
        <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Connected Hosts <span className="text-amber ml-1">{list.length}</span></span>
        <button onClick={() => refetch()} className="text-text-mute hover:text-amber transition-colors"><RefreshCw size={13} /></button>
      </div>
      {isLoading ? (
        <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
      ) : !list.length ? (
        <EmptyState title="No hosts connected" icon={Wifi} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-dim">
                {['MAC','IP','Bridge','Status','Uptime'].map(h => (
                  <th key={h} className="text-left px-4 py-2 text-mono text-[10px] text-text-mute uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((h, i) => (
                <tr key={h['.id'] || i} className="border-b border-border-dim last:border-0 hover:bg-surface2/30">
                  <td className="px-4 py-3 font-mono text-xs text-amber">{h['mac-address']}</td>
                  <td className="px-4 py-3 font-mono text-xs">{h.address || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-text-dim">{h['bridge-port'] || h.server || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`tag ${h.status === 'authorized' ? 'tag-success' : 'tag-dim'}`}>{h.status || 'seen'}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-mute">{h.uptime || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Log ───────────────────────────────────────────────────────
function LogTab({ routerId }) {
  const [logType, setLogType] = useState('hotspot');
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['hotspot-log', routerId, logType],
    queryFn: () => logType === 'hotspot' ? apiHotspotLog(routerId) : import('../api/client').then(m => m.apiAppLog('system,error,warning', routerId)),
    refetchInterval: 30_000,
  });

  const list = data || [];

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border-dim">
        <div className="flex items-center gap-2">
          <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">Log</span>
          <div className="flex gap-1 ml-3">
            {[['hotspot','Hotspot'],['system','System']].map(([k,l]) => (
              <button key={k} onClick={() => setLogType(k)}
                className={`text-[10px] font-mono px-2 py-1 rounded uppercase tracking-wider ${logType===k?'bg-amber text-black':'text-text-dim hover:bg-surface2'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => refetch()} className="text-text-mute hover:text-amber"><RefreshCw size={13} /></button>
      </div>
      {isLoading ? (
        <div className="p-4 space-y-1">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-8" />)}</div>
      ) : !list.length ? (
        <EmptyState title="No log entries" icon={FileText} />
      ) : (
        <div className="overflow-y-auto max-h-[500px]">
          {list.map((e, i) => {
            const topics = e.topics || '';
            const color = topics.includes('error') ? 'text-red' : topics.includes('warning') ? 'text-amber' : 'text-text-dim';
            return (
              <div key={i} className="flex gap-3 px-5 py-2 border-b border-border-dim last:border-0 text-xs font-mono hover:bg-surface2/20">
                <span className="text-text-mute shrink-0 w-32">{e.time}</span>
                <span className={`shrink-0 w-24 ${color}`}>{topics}</span>
                <span className="text-text">{e.message}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────
function fmtBytes(b) {
  const n = Number(b);
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n/1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n/1048576).toFixed(1)} MB`;
  return `${(n/1073741824).toFixed(2)} GB`;
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:'rgba(0,0,0,0.75)'}} onClick={onClose}>
      <div className="panel p-6 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-display text-xl italic">{title}</h3>
          <button onClick={onClose} className="text-text-mute hover:text-amber"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-[10px] text-text-mute font-mono uppercase mb-1.5">
        {label}{required && <span className="text-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
