/**
 * Per-subscription daily bandwidth chart.
 *
 * Fetches from `/api/subscriptions/:id/bandwidth` (or whatever
 * `fetcher` you pass in) and renders a compact stacked-bar chart
 * of download vs upload. Re-used on both the admin's customer
 * detail page and the customer portal's "My account" dashboard.
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, Upload, TrendingUp } from 'lucide-react';

const RANGES = [
  { value: 7,  label: '7 days'  },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
];

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024)              return `${n} B`;
  if (n < 1024 ** 2)         return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3)         return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024 ** 4)         return `${(n / 1024 ** 3).toFixed(2)} GB`;
  return                            `${(n / 1024 ** 4).toFixed(2)} TB`;
}

export default function BandwidthChart({ fetcher, defaultDays = 14, compact = false }) {
  const [days, setDays] = useState(defaultDays);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setErr(''); setRows(null);
    fetcher(days)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.error || e.message); });
    return () => { cancelled = true; };
  }, [days, fetcher]);

  const totals = useMemo(() => {
    if (!rows) return { inB: 0, outB: 0, max: 0 };
    let inB = 0, outB = 0, max = 0;
    for (const r of rows) {
      inB  += Number(r.bytes_in)  || 0;
      outB += Number(r.bytes_out) || 0;
      const t = (Number(r.bytes_in) || 0) + (Number(r.bytes_out) || 0);
      if (t > max) max = t;
    }
    return { inB, outB, max };
  }, [rows]);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-amber" />
          <div className="text-mono text-[10px] uppercase tracking-wider text-text-mute">
            Bandwidth — last {days} days
          </div>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setDays(r.value)}
              className={`text-mono text-[10px] px-2 py-0.5 rounded-sm ${
                days === r.value ? 'bg-amber text-black' : 'text-text-dim hover:text-text'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {err ? (
        <div className="text-xs text-red font-mono py-4">{err}</div>
      ) : !rows ? (
        <div className="h-24 animate-pulse bg-surface2 rounded-sm" />
      ) : totals.max === 0 ? (
        <div className="text-xs text-text-mute py-4 text-center italic">
          No traffic recorded in this range yet.
        </div>
      ) : (
        <>
          <div className={`flex items-end gap-1 ${compact ? 'h-16' : 'h-28'}`}>
            {rows.map((r) => {
              const total = Number(r.bytes_in) + Number(r.bytes_out);
              const inH  = totals.max ? (Number(r.bytes_in)  / totals.max) * 100 : 0;
              const outH = totals.max ? (Number(r.bytes_out) / totals.max) * 100 : 0;
              return (
                <div
                  key={r.day}
                  className="flex-1 flex flex-col justify-end gap-px min-w-[6px]"
                  title={`${r.day}\n↓ ${fmtBytes(r.bytes_in)}\n↑ ${fmtBytes(r.bytes_out)}\ntotal ${fmtBytes(total)}`}
                >
                  <div style={{ height: `${outH}%` }} className="bg-cyan/70 rounded-t-sm" />
                  <div style={{ height: `${inH}%`  }} className="bg-amber/80" />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-mono text-[10px] text-text-mute">
            <span>{rows[0]?.day}</span>
            <span>{rows[rows.length - 1]?.day}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <Download size={12} className="text-amber" />
              <span className="text-text-mute">Download</span>
              <span className="font-mono text-text ml-auto">{fmtBytes(totals.inB)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Upload size={12} className="text-cyan-400" />
              <span className="text-text-mute">Upload</span>
              <span className="font-mono text-text ml-auto">{fmtBytes(totals.outB)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export { fmtBytes };
