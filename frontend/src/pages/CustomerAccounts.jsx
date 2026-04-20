import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCheck, UserX, Shield, KeyRound, Pause, Users as UsersIcon } from 'lucide-react';
import {
  apiCustomerAccounts,
  apiApproveAccount, apiRejectAccount,
  apiSuspendAccount, apiResetAccountPw,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, Skeleton, StatusPill } from '../components/primitives';

const STATUS_TABS = [
  { value: 'pending',   label: 'Pending',   icon: UserCheck },
  { value: 'approved',  label: 'Approved',  icon: UsersIcon },
  { value: 'rejected',  label: 'Rejected',  icon: UserX },
  { value: 'suspended', label: 'Suspended', icon: Pause },
  { value: 'all',       label: 'All',       icon: Shield },
];

export default function CustomerAccounts() {
  const [status, setStatus] = useState('pending');
  const qc = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['customer-accounts', status],
    queryFn: () => apiCustomerAccounts(status),
    refetchInterval: 30_000,
  });

  const approve = useMutation({
    mutationFn: apiApproveAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer-accounts'] }),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }) => apiRejectAccount(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer-accounts'] }),
  });
  const suspend = useMutation({
    mutationFn: apiSuspendAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer-accounts'] }),
  });
  const resetPw = useMutation({
    mutationFn: ({ id, password }) => apiResetAccountPw(id, password),
  });

  return (
    <div>
      <PageHeader
        kicker="Portal"
        title={<>Customer <em>accounts</em></>}
        subtitle="Self-service signups waiting for your review. Approve to let the customer log in to their dashboard."
      />
      <div className="px-8 pt-4">
        <div className="flex items-center gap-1 border-b border-border-dim">
          {STATUS_TABS.map((t) => {
            const Icon = t.icon;
            const active = status === t.value;
            return (
              <button
                key={t.value}
                onClick={() => setStatus(t.value)}
                className={`px-3 py-2 text-xs font-mono uppercase tracking-wider flex items-center gap-1.5 border-b-2 transition-colors ${
                  active ? 'border-amber text-amber' : 'border-transparent text-text-mute hover:text-text'
                }`}
              >
                <Icon size={12} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-8">
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : !accounts.length ? (
          <EmptyState
            title="Nothing here"
            hint={`No ${status} accounts.`}
          />
        ) : (
          <div className="space-y-3">
            {accounts.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                onApprove={() => approve.mutate(a.id)}
                onReject={(reason) => reject.mutate({ id: a.id, reason })}
                onSuspend={() => suspend.mutate(a.id)}
                onResetPw={(password) => resetPw.mutate({ id: a.id, password })}
                busy={approve.isPending || reject.isPending || suspend.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AccountRow({ account, onApprove, onReject, onSuspend, onResetPw, busy }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [resetting, setResetting] = useState(false);
  const [newPw, setNewPw] = useState('');

  return (
    <div className="panel p-5">
      <div className="grid md:grid-cols-4 gap-4 items-center">
        <div>
          <div className="text-display text-xl italic">{account.full_name}</div>
          <div className="text-mono text-xs text-text-mute mt-1">
            {account.phone}{account.email ? ` · ${account.email}` : ''}
          </div>
          {account.customer_code && (
            <div className="text-mono text-[10px] text-text-dim mt-0.5">
              Linked → {account.customer_code}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <StatusPill status={account.status} />
          <div className="text-[10px] text-text-mute font-mono">
            signed up {new Date(account.created_at).toLocaleString()}
          </div>
          {account.last_login_at && (
            <div className="text-[10px] text-text-mute font-mono">
              last login {new Date(account.last_login_at).toLocaleString()}
            </div>
          )}
          {account.reject_reason && (
            <div className="text-[10px] text-red font-mono">reason: {account.reject_reason}</div>
          )}
        </div>

        <div />

        <div className="flex items-center gap-2 justify-end flex-wrap">
          {account.status === 'pending' && (
            <>
              <button onClick={onApprove} disabled={busy} className="btn btn-primary">
                <UserCheck size={14} /> Approve
              </button>
              <button onClick={() => setRejecting((v) => !v)} className="btn btn-danger">
                <UserX size={14} /> Reject
              </button>
            </>
          )}
          {account.status === 'approved' && (
            <>
              <button onClick={onSuspend} disabled={busy} className="btn btn-ghost">
                <Pause size={14} /> Suspend
              </button>
              <button onClick={() => setResetting((v) => !v)} className="btn btn-ghost">
                <KeyRound size={14} /> Reset pw
              </button>
            </>
          )}
          {account.status === 'suspended' && (
            <button onClick={onApprove} disabled={busy} className="btn btn-primary">
              <UserCheck size={14} /> Re-approve
            </button>
          )}
        </div>
      </div>

      {rejecting && (
        <div className="mt-4 pt-4 border-t border-border-dim flex gap-2 items-center">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (shown to customer)"
            className="input flex-1"
            autoFocus
          />
          <button
            onClick={() => { onReject(reason); setRejecting(false); setReason(''); }}
            disabled={!reason.trim()}
            className="btn btn-danger"
          >Confirm</button>
          <button onClick={() => setRejecting(false)} className="btn btn-ghost">Cancel</button>
        </div>
      )}

      {resetting && (
        <div className="mt-4 pt-4 border-t border-border-dim flex gap-2 items-center">
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (min 6 chars)"
            className="input flex-1"
            autoFocus
          />
          <button
            onClick={() => { onResetPw(newPw); setResetting(false); setNewPw(''); }}
            disabled={newPw.length < 6}
            className="btn btn-primary"
          >Set</button>
          <button onClick={() => setResetting(false)} className="btn btn-ghost">Cancel</button>
        </div>
      )}
    </div>
  );
}
