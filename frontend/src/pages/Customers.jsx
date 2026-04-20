import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Users, ChevronRight, Phone } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { apiCustomers } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { StatusPill, EmptyState, Skeleton } from '../components/primitives';

export default function Customers() {
  const [q, setQ] = useState('');
  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers', q],
    queryFn: () => apiCustomers(q || undefined, 100),
  });

  return (
    <div>
      <PageHeader
        kicker="Directory"
        title={<>The <em>customers</em></>}
        subtitle="Every person on your network, searchable by name, phone, or code."
        actions={
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-mute" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, phone, SKY-XXXXX…"
              className="input pl-9 w-80"
            />
          </div>
        }
      />
      <div className="p-8">
        {isLoading ? (
          <div className="panel p-4 space-y-2">
            {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : !customers?.length ? (
          <div className="panel">
            <EmptyState
              title={q ? 'No matches' : 'No customers yet'}
              hint={q ? `Nothing found for "${q}"` : 'They will appear here as orders are approved.'}
              icon={Users}
            />
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
              <div className="col-span-3">Code · Name</div>
              <div className="col-span-2">Phone</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Subs</div>
              <div className="col-span-2">Latest expiry</div>
              <div className="col-span-1 text-right">—</div>
            </div>
            <ul>
              {customers.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/customers/${c.id}`}
                    className="grid grid-cols-12 px-5 py-3.5 items-center ticker-row group"
                  >
                    <div className="col-span-3">
                      <div className="text-mono text-[11px] text-amber">{c.customer_code}</div>
                      <div className="text-sm truncate">{c.full_name}</div>
                    </div>
                    <div className="col-span-2 text-sm font-mono text-text-dim flex items-center gap-1.5">
                      <Phone size={11} className="text-text-mute" /> {c.phone}
                    </div>
                    <div className="col-span-2"><StatusPill status={c.status} /></div>
                    <div className="col-span-2 text-mono text-sm text-text-dim">{c.subscription_count || 0}</div>
                    <div className="col-span-2 text-mono text-xs text-text-dim">
                      {c.latest_expiry
                        ? formatDistanceToNow(new Date(c.latest_expiry), { addSuffix: true })
                        : <span className="text-text-mute">—</span>}
                    </div>
                    <div className="col-span-1 text-right">
                      <ChevronRight size={14} className="inline text-text-mute group-hover:text-amber group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {customers?.length >= 100 && (
          <p className="text-center text-xs text-text-mute mt-4 font-mono">
            Showing first 100 · narrow your search for more.
          </p>
        )}
      </div>
    </div>
  );
}
