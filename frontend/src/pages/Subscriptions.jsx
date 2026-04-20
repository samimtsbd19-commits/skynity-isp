import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, ChevronRight, Filter } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { apiSubscriptions } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { StatusPill, EmptyState, Skeleton } from '../components/primitives';

const FILTERS = [
  { value: '',          label: 'All' },
  { value: 'active',    label: 'Active' },
  { value: 'expired',   label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
];

export default function Subscriptions() {
  const [filter, setFilter] = useState('active');
  const { data: subs, isLoading } = useQuery({
    queryKey: ['subscriptions', filter],
    queryFn: () => apiSubscriptions(filter || undefined),
    refetchInterval: 60_000,
  });

  return (
    <div>
      <PageHeader
        kicker="Service"
        title={<>Active <em>subscriptions</em></>}
        subtitle="Every paying seat on your network, grouped by state."
      />
      <div className="px-8 py-6">
        <div className="flex items-center gap-1 mb-6 border-b border-border-dim pb-4">
          <Filter size={14} className="text-text-mute mr-2" />
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors rounded-sm ${
                filter === f.value
                  ? 'bg-amber text-black'
                  : 'text-text-dim hover:text-text hover:bg-surface2'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="panel p-4 space-y-2">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : !subs?.length ? (
          <div className="panel">
            <EmptyState title="No subscriptions" hint="Try a different filter." icon={Activity} />
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
              <div className="col-span-3">Customer</div>
              <div className="col-span-2">Service</div>
              <div className="col-span-2">Login</div>
              <div className="col-span-2">Package</div>
              <div className="col-span-2">Expires</div>
              <div className="col-span-1 text-right">—</div>
            </div>
            <ul>
              {subs.map((s) => {
                const expires = new Date(s.expires_at);
                const expired = expires < new Date();
                const days = Math.ceil((expires - new Date()) / 86400000);
                return (
                  <li key={s.id}>
                    <Link
                      to={`/customers/${s.customer_id}`}
                      className="grid grid-cols-12 px-5 py-3.5 items-center ticker-row group"
                    >
                      <div className="col-span-3">
                        <div className="text-mono text-[11px] text-amber">{s.customer_code}</div>
                        <div className="text-sm truncate">{s.full_name}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="flex items-center gap-2">
                          <span className={`led ${s.status === 'active' && !expired ? 'led-on' : expired ? 'led-off' : 'led-warn'}`} />
                          <span className="tag tag-dim">{s.service_type.toUpperCase()}</span>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <code className="text-mono text-sm text-text-dim">{s.login_username}</code>
                      </div>
                      <div className="col-span-2 text-sm truncate">{s.package_name}</div>
                      <div className="col-span-2">
                        <div className="text-mono text-xs">{expires.toLocaleDateString()}</div>
                        <div className={`text-[10px] font-mono ${expired ? 'text-red' : days < 3 ? 'text-amber' : 'text-text-mute'}`}>
                          {expired ? 'Expired' : `${days}d left`}
                        </div>
                      </div>
                      <div className="col-span-1 text-right">
                        <ChevronRight size={14} className="inline text-text-mute group-hover:text-amber group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
