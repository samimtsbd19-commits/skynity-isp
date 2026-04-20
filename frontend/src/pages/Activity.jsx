import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiActivityLog } from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { Skeleton } from '../components/primitives';

const PAGE = 50;

export default function Activity() {
  const [offset, setOffset] = useState(0);
  const { data, isLoading } = useQuery({
    queryKey: ['activity-log', offset],
    queryFn: () => apiActivityLog(PAGE, offset),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + entries.length < total;

  return (
    <div>
      <PageHeader
        kicker="Audit"
        title={<>Activity <em>log</em></>}
        subtitle="Admin actions and system events recorded in the database."
      />
      <div className="px-8 py-6">
        <div className="flex items-center justify-end gap-2 mb-4">
          <button
            type="button"
            disabled={!hasPrev || isLoading}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
            className="btn btn-ghost text-xs"
          >
            <ChevronLeft size={14} /> Newer
          </button>
          <button
            type="button"
            disabled={!hasNext || isLoading}
            onClick={() => setOffset((o) => o + PAGE)}
            className="btn btn-ghost text-xs"
          >
            Older <ChevronRight size={14} />
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : (
          <div className="panel overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-mono text-[10px] text-text-mute uppercase tracking-wider">
              <div className="col-span-2">When</div>
              <div className="col-span-2">Actor</div>
              <div className="col-span-2">Action</div>
              <div className="col-span-2">Entity</div>
              <div className="col-span-4">Meta</div>
            </div>
            <ul>
              {!entries.length ? (
                <li className="px-5 py-12 text-center text-text-mute text-sm">No entries yet.</li>
              ) : (
                entries.map((row) => (
                  <li key={row.id} className="grid grid-cols-12 px-5 py-3 border-b border-border-dim text-sm ticker-row">
                    <div className="col-span-2 font-mono text-[11px] text-text-dim">
                      {new Date(row.created_at).toLocaleString()}
                    </div>
                    <div className="col-span-2 text-xs">
                      <span className="tag tag-dim">{row.actor_type}</span>
                      {row.actor_id && (
                        <span className="text-text-mute ml-1 font-mono text-[10px]">{row.actor_id}</span>
                      )}
                    </div>
                    <div className="col-span-2 font-mono text-xs text-amber">{row.action}</div>
                    <div className="col-span-2 text-xs text-text-dim">
                      {row.entity_type || '—'} {row.entity_id ? `#${row.entity_id}` : ''}
                    </div>
                    <div className="col-span-4 font-mono text-[11px] text-text-mute truncate" title={metaStr(row.meta)}>
                      {metaStr(row.meta)}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
        <p className="text-center text-xs text-text-mute mt-4 font-mono">
          {total ? `Showing ${offset + 1}–${offset + entries.length} of ${total}` : null}
        </p>
      </div>
    </div>
  );
}

function metaStr(meta) {
  if (meta == null) return '—';
  if (typeof meta === 'string') return meta;
  try {
    return JSON.stringify(meta);
  } catch {
    return '—';
  }
}
