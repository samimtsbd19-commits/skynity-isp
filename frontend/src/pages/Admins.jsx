import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCog, Plus, Trash2, X, Check } from 'lucide-react';
import { apiAdmins, apiAdminCreate, apiAdminUpdate, apiAdminDelete } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton, EmptyState, ConfirmButton } from '../components/primitives';

const ROLES = ['superadmin', 'admin', 'reseller', 'viewer'];

export default function Admins() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data: admins, isLoading } = useQuery({ queryKey: ['admins'], queryFn: apiAdmins });

  const toggle = useMutation({
    mutationFn: ({ id, is_active }) => apiAdminUpdate(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admins'] }),
  });
  const del = useMutation({
    mutationFn: apiAdminDelete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admins'] }),
  });
  const updateRole = useMutation({
    mutationFn: ({ id, role }) => apiAdminUpdate(id, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admins'] }),
  });

  return (
    <div>
      <PageHeader
        kicker="Team"
        title={<>Admin <em>users</em></>}
        subtitle="Manage everyone with access to this dashboard. Roles: superadmin · admin · reseller · viewer."
        actions={
          <button onClick={() => setCreating(true)} className="btn btn-primary">
            <Plus size={14} /> New admin
          </button>
        }
      />
      <div className="p-8">
        {creating && <NewAdminForm onClose={() => setCreating(false)} />}
        {isLoading ? (
          <Skeleton className="h-16" />
        ) : !admins?.length ? (
          <div className="panel"><EmptyState title="No admins yet" icon={UserCog} /></div>
        ) : (
          <div className="panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Telegram</th>
                  <th className="text-left px-4 py-3">Last login</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id} className="border-b border-border-dim hover:bg-surface2/30">
                    <td className="px-4 py-3">
                      <div className="text-text">{a.full_name}</div>
                      <div className="text-text-mute text-[11px] font-mono">@{a.username}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        className="input text-xs py-1"
                        value={a.role}
                        onChange={(e) => updateRole.mutate({ id: a.id, role: e.target.value })}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 font-mono text-text-dim text-xs">{a.telegram_id || '—'}</td>
                    <td className="px-4 py-3 font-mono text-text-dim text-xs">
                      {a.last_login_at ? new Date(a.last_login_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggle.mutate({ id: a.id, is_active: a.is_active ? 0 : 1 })}
                        className={`text-[11px] font-mono uppercase tracking-wider ${a.is_active ? 'text-green' : 'text-text-mute'}`}
                      >
                        {a.is_active ? '● Active' : '○ Disabled'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ConfirmButton variant="danger" confirmText="Delete?" onConfirm={() => del.mutate(a.id)}>
                        <Trash2 size={13} />
                      </ConfirmButton>
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

function NewAdminForm({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    username: '', password: '', full_name: '', telegram_id: '', role: 'admin',
  });
  const [err, setErr] = useState('');
  const create = useMutation({
    mutationFn: () => apiAdminCreate(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admins'] }); onClose(); },
    onError: (e) => setErr(e?.response?.data?.error || e.message),
  });
  const up = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="panel p-6 mb-6 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-display text-2xl italic">New admin</h3>
        <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
        className="grid grid-cols-2 gap-4"
      >
        <Field label="Username"><input className="input" value={form.username} onChange={up('username')} required /></Field>
        <Field label="Full name"><input className="input" value={form.full_name} onChange={up('full_name')} required /></Field>
        <Field label="Password (8+ chars)"><input type="password" className="input" value={form.password} onChange={up('password')} required minLength={8} /></Field>
        <Field label="Role">
          <select className="input" value={form.role} onChange={up('role')}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Telegram ID (optional)" full>
          <input className="input" value={form.telegram_id} onChange={up('telegram_id')} placeholder="numeric id" />
        </Field>
        {err && <div className="col-span-2 text-red text-sm font-mono px-3 py-2 border border-red/40 bg-red/5 rounded-sm">{err}</div>}
        <div className="col-span-2 flex gap-2 pt-2">
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            <Check size={14} /> {create.isPending ? 'Creating…' : 'Create admin'}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''}`}>
      <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
