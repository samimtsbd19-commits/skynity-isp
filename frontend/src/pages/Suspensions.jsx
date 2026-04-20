// ============================================================
// Active suspensions list
// ------------------------------------------------------------
// A single place for the admin to see every customer who is
// currently disabled on the network, with their reason, start
// time, scheduled end (if temporary), and a one-click "Restore"
// button that lifts the suspension immediately.
// ============================================================
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, ShieldCheck, Clock, User, Calendar } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { apiSuspensions, apiSuspensionLift } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, Skeleton } from '../components/primitives';
import { useT } from '../i18n';

export default function Suspensions() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['suspensions'],
    queryFn: apiSuspensions,
    refetchInterval: 60_000,
  });
  const lift = useMutation({
    mutationFn: (id) => apiSuspensionLift(id, { reason: 'Restored via Suspensions page' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['suspensions'] }),
  });

  const rows = q.data || [];

  return (
    <div>
      <PageHeader
        kicker="Enforcement"
        title={<><Ban size={18} className="inline mr-2 text-red" /> {t('nav.suspensions')}</>}
        subtitle="Every customer who is currently disabled on the network."
      />
      <div className="p-8">
        {q.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !rows.length ? (
          <div className="panel p-12">
            <EmptyState
              icon={ShieldCheck}
              title="No active suspensions"
              hint="All customers are currently allowed on the network."
            />
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
              <div className="col-span-3">Customer</div>
              <div className="col-span-2">Reason</div>
              <div className="col-span-2">Started</div>
              <div className="col-span-3">Ends</div>
              <div className="col-span-2 text-right">Action</div>
            </div>
            <ul>
              {rows.map((s) => <Row key={s.id} row={s} onLift={() => lift.mutate(s.id)} lifting={lift.isPending} />)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ row, onLift, lifting }) {
  const started = new Date(row.starts_at || row.created_at);
  const ends = row.ends_at ? new Date(row.ends_at) : null;
  const endLabel = row.is_permanent
    ? <span className="text-red font-bold">PERMANENT BAN</span>
    : ends
      ? (
        <>
          <span className="font-mono text-xs">{ends.toLocaleString()}</span>
          <span className="text-[10px] text-text-mute ml-2">
            ({formatDistanceToNow(ends, { addSuffix: true })})
          </span>
        </>
      )
      : '—';
  return (
    <li className="grid grid-cols-12 px-5 py-3 items-center ticker-row">
      <div className="col-span-3">
        <Link to={`/customers/${row.customer_id}`} className="flex items-center gap-2 text-sm hover:text-amber">
          <User size={12} className="text-text-mute" />
          <span>{row.full_name}</span>
        </Link>
        <div className="text-[11px] text-text-mute font-mono">
          {row.customer_code} · {row.phone}
        </div>
      </div>
      <div className="col-span-2 text-sm">
        <span className="tag tag-red">{row.reason}</span>
        {row.notes && <div className="text-[10px] text-text-mute font-mono mt-1 truncate" title={row.notes}>{row.notes}</div>}
      </div>
      <div className="col-span-2 text-xs font-mono text-text-dim">
        <div className="flex items-center gap-1"><Calendar size={11} /> {started.toLocaleDateString()}</div>
        <div className="text-[10px] text-text-mute mt-0.5">{formatDistanceToNow(started, { addSuffix: true })}</div>
      </div>
      <div className="col-span-3 flex items-center gap-2">
        <Clock size={12} className="text-text-mute" />
        <span>{endLabel}</span>
      </div>
      <div className="col-span-2 text-right">
        <button
          className="btn btn-ghost text-green"
          disabled={lifting}
          onClick={onLift}
          title="Restore this customer immediately"
        >
          <ShieldCheck size={14} /> Restore
        </button>
      </div>
    </li>
  );
}
