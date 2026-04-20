import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Plus, RefreshCw, Trash2, Power, Users, Download, X, Check, AlertCircle,
} from 'lucide-react';
import {
  apiVpnTunnels, apiVpnTunnelCreate, apiVpnTunnelSync, apiVpnTunnelToggle, apiVpnTunnelDelete,
  apiVpnPeers, apiVpnPeerCreate, apiVpnPeerSync, apiVpnPeerDelete, apiVpnPeerConfigUrl,
  apiRouters,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton, EmptyState, ConfirmButton } from '../components/primitives';

const KINDS = [
  { value: 'wireguard', label: 'WireGuard' },
  { value: 'ipsec',     label: 'IPsec' },
  { value: 'pptp',      label: 'PPTP' },
  { value: 'l2tp',      label: 'L2TP' },
  { value: 'ovpn',      label: 'OpenVPN' },
  { value: 'sstp',      label: 'SSTP' },
];

export default function Vpn() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [openPeers, setOpenPeers] = useState(null);

  const { data: tunnels, isLoading } = useQuery({
    queryKey: ['vpn.tunnels'], queryFn: () => apiVpnTunnels(),
  });
  const { data: routers = [] } = useQuery({ queryKey: ['routers'], queryFn: apiRouters });

  const sync = useMutation({
    mutationFn: apiVpnTunnelSync,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vpn.tunnels'] }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }) => apiVpnTunnelToggle(id, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vpn.tunnels'] }),
  });
  const del = useMutation({
    mutationFn: apiVpnTunnelDelete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vpn.tunnels'] }),
  });

  return (
    <div>
      <PageHeader
        kicker="VPN"
        title={<>Tunnels &amp; <em>peers</em></>}
        subtitle="WireGuard, IPsec, PPTP, L2TP, OpenVPN, SSTP — managed centrally, synced to MikroTik via REST API."
        actions={
          <button onClick={() => setCreating(true)} className="btn btn-primary">
            <Plus size={14} /> New tunnel
          </button>
        }
      />
      <div className="p-8">
        {creating && <NewTunnelForm routers={routers} onClose={() => setCreating(false)} />}

        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16" />)}</div>
        ) : !tunnels?.length ? (
          <div className="panel"><EmptyState title="No VPN tunnels yet" icon={Shield} hint="Create a tunnel and sync it to a router. WireGuard peers can be issued from here." /></div>
        ) : (
          <div className="grid gap-3">
            {tunnels.map((t) => (
              <div key={t.id} className={`panel p-5 ${!t.is_enabled ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="tag tag-cyan">{t.kind}</span>
                      <span className="text-display text-xl italic">{t.name}</span>
                      <span className={`tag ${t.mt_synced ? 'tag-green' : 'tag-amber'}`}>
                        {t.mt_synced ? 'synced' : 'unsynced'}
                      </span>
                    </div>
                    {t.mt_error && (
                      <div className="mt-1 text-red text-[11px] font-mono flex items-center gap-1">
                        <AlertCircle size={11} /> {t.mt_error}
                      </div>
                    )}
                    <div className="mt-2 text-[11px] font-mono text-text-mute">
                      {t.listen_port && <>port <span className="text-text-dim">{t.listen_port}</span> · </>}
                      {t.local_address && <>local <span className="text-text-dim">{t.local_address}</span> · </>}
                      {t.remote_address && <>remote <span className="text-text-dim">{t.remote_address}</span></>}
                    </div>
                    {t.public_key && (
                      <div className="mt-1 text-[11px] font-mono text-text-mute break-all">
                        pubkey <span className="text-text-dim">{t.public_key}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => sync.mutate(t.id)} className="btn btn-ghost" title="Sync to router">
                      <RefreshCw size={13} />
                    </button>
                    <button
                      onClick={() => toggle.mutate({ id: t.id, enabled: !t.is_enabled })}
                      className="btn btn-ghost"
                      title={t.is_enabled ? 'Disable' : 'Enable'}
                    >
                      <Power size={13} className={t.is_enabled ? 'text-green' : 'text-text-mute'} />
                    </button>
                    {t.kind === 'wireguard' && (
                      <button onClick={() => setOpenPeers(t)} className="btn btn-ghost" title="Peers">
                        <Users size={13} />
                      </button>
                    )}
                    <ConfirmButton
                      variant="danger"
                      confirmText="Delete?"
                      onConfirm={() => del.mutate(t.id)}
                    >
                      <Trash2 size={13} />
                    </ConfirmButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {openPeers && <PeersModal tunnel={openPeers} onClose={() => setOpenPeers(null)} />}
      </div>
    </div>
  );
}

function NewTunnelForm({ routers, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    router_id: '', kind: 'wireguard', name: '',
    listen_port: 51820, local_address: '10.88.0.1/24',
    remote_address: '', mtu: 1420, secret: '',
  });
  const [err, setErr] = useState('');

  const create = useMutation({
    mutationFn: apiVpnTunnelCreate,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vpn.tunnels'] }); onClose(); },
    onError: (e) => setErr(e?.response?.data?.error || e.message),
  });

  const up = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="panel p-6 mb-6 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-display text-2xl italic">New VPN tunnel</h3>
        <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); create.mutate({ ...form, router_id: Number(form.router_id), listen_port: Number(form.listen_port) || null, mtu: Number(form.mtu) || null }); }}
        className="grid grid-cols-2 gap-4"
      >
        <Field label="Router">
          <select className="input" value={form.router_id} onChange={up('router_id')} required>
            <option value="">— select —</option>
            {routers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label="Kind">
          <select className="input" value={form.kind} onChange={up('kind')}>
            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <Field label="Name"><input className="input" value={form.name} onChange={up('name')} placeholder="wg0" required /></Field>
        <Field label="Listen port"><input type="number" className="input" value={form.listen_port} onChange={up('listen_port')} /></Field>
        <Field label="Local address (CIDR)"><input className="input" value={form.local_address} onChange={up('local_address')} /></Field>
        <Field label="Remote endpoint (host:port)"><input className="input" value={form.remote_address} onChange={up('remote_address')} placeholder="optional" /></Field>
        {form.kind === 'wireguard' && (
          <Field label="MTU"><input type="number" className="input" value={form.mtu} onChange={up('mtu')} /></Field>
        )}
        {(form.kind === 'l2tp' || form.kind === 'ipsec') && (
          <Field label="IPsec secret / pre-shared key"><input className="input" value={form.secret} onChange={up('secret')} /></Field>
        )}

        {err && (
          <div className="col-span-2 text-red text-sm font-mono px-3 py-2 border border-red/40 bg-red/5 rounded-sm">{err}</div>
        )}
        <div className="col-span-2 flex gap-2 pt-2">
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            <Check size={14} /> {create.isPending ? 'Creating…' : 'Create'}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
        </div>
        <div className="col-span-2 text-[11px] text-text-mute font-mono">
          WireGuard keypair is auto-generated if not provided. Click "Sync" after creating.
        </div>
      </form>
    </div>
  );
}

function PeersModal({ tunnel, onClose }) {
  const qc = useQueryClient();
  const { data: peers = [], isLoading } = useQuery({
    queryKey: ['vpn.peers', tunnel.id],
    queryFn: () => apiVpnPeers(tunnel.id),
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [err, setErr] = useState('');

  const create = useMutation({
    mutationFn: () => apiVpnPeerCreate(tunnel.id, { name, allowed_address: ip }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vpn.peers', tunnel.id] }); setAdding(false); setName(''); setIp(''); },
    onError: (e) => setErr(e?.response?.data?.error || e.message),
  });
  const sync = useMutation({
    mutationFn: apiVpnPeerSync,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vpn.peers', tunnel.id] }),
  });
  const del = useMutation({
    mutationFn: apiVpnPeerDelete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vpn.peers', tunnel.id] }),
  });

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="panel p-6 w-full max-w-3xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-display text-xl italic">Peers — {tunnel.name}</h3>
          <div className="flex gap-2">
            <button onClick={() => setAdding(true)} className="btn btn-primary"><Plus size={13} /> Add peer</button>
            <button onClick={onClose} className="text-text-mute hover:text-text"><X size={16} /></button>
          </div>
        </div>

        {adding && (
          <div className="panel p-4 mb-4 bg-surface2/40">
            <div className="grid grid-cols-2 gap-3">
              <input className="input" placeholder="peer name (e.g. alice)" value={name} onChange={(e) => setName(e.target.value)} />
              <input className="input" placeholder="allowed address e.g. 10.88.0.2/32" value={ip} onChange={(e) => setIp(e.target.value)} />
            </div>
            {err && <div className="text-red text-xs font-mono mt-2">{err}</div>}
            <div className="mt-3 flex gap-2">
              <button onClick={() => create.mutate()} className="btn btn-primary" disabled={!name}>
                <Check size={13} /> Create + generate keys
              </button>
              <button onClick={() => setAdding(false)} className="btn btn-ghost">Cancel</button>
            </div>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-16" />
        ) : !peers.length ? (
          <EmptyState title="No peers yet" icon={Users} />
        ) : (
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b border-border-dim text-text-mute">
                <th className="text-left py-2">Name</th>
                <th className="text-left py-2">Allowed IP</th>
                <th className="text-left py-2">Public key</th>
                <th className="text-left py-2">Sync</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {peers.map((p) => (
                <tr key={p.id} className="border-b border-border-dim">
                  <td className="py-2">{p.name}</td>
                  <td className="py-2">{p.allowed_address || '—'}</td>
                  <td className="py-2 text-text-mute truncate max-w-[180px]">{p.public_key}</td>
                  <td className="py-2">
                    <span className={`tag ${p.mt_synced ? 'tag-green' : 'tag-amber'}`}>
                      {p.mt_synced ? 'ok' : 'pending'}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <div className="inline-flex gap-1">
                      <button onClick={() => sync.mutate(p.id)} className="btn btn-ghost" title="Sync to router">
                        <RefreshCw size={12} />
                      </button>
                      <a href={apiVpnPeerConfigUrl(p.id)} className="btn btn-ghost" title="Download wg-quick config">
                        <Download size={12} />
                      </a>
                      <ConfirmButton variant="danger" confirmText="?" onConfirm={() => del.mutate(p.id)}>
                        <Trash2 size={12} />
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-mono text-[10px] text-text-mute uppercase tracking-wider">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
