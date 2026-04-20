import clsx from 'clsx';
import { TrendingUp, TrendingDown } from 'lucide-react';

export function StatCard({ label, value, unit, hint, trend, icon: Icon, accent, loading }) {
  const trendPositive = trend?.startsWith('+');
  return (
    <div className="stat group animate-fade-up">
      <div className="flex items-start justify-between mb-3">
        <div className="text-mono text-[10px] text-text-mute uppercase tracking-[0.2em]">
          {label}
        </div>
        {Icon && (
          <Icon size={14} strokeWidth={1.5} className={clsx('text-text-mute group-hover:text-amber transition-colors', accent)} />
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        {loading ? (
          <div className="h-8 w-20 bg-surface2 rounded-sm animate-pulse" />
        ) : (
          <>
            <span className="text-display text-4xl leading-none">
              {value}
            </span>
            {unit && <span className="text-mono text-xs text-text-mute">{unit}</span>}
          </>
        )}
      </div>
      {(hint || trend) && (
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          {trend && (
            <span className={clsx('inline-flex items-center gap-1 font-mono',
              trendPositive ? 'text-green' : 'text-red')}>
              {trendPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {trend}
            </span>
          )}
          {hint && <span className="text-text-mute">{hint}</span>}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, icon: Icon }) {
  return (
    <div className="py-16 flex flex-col items-center justify-center text-center">
      {Icon && <Icon size={32} className="text-text-mute mb-3" strokeWidth={1} />}
      <div className="text-display text-xl text-text-dim italic">{title}</div>
      {hint && <div className="text-sm text-text-mute mt-1 max-w-sm">{hint}</div>}
    </div>
  );
}

export function StatusPill({ status }) {
  const map = {
    active:           ['tag-green', 'Active'],
    pending:          ['tag-amber', 'Pending'],
    pending_payment:  ['tag-amber', 'Awaiting Pay'],
    payment_submitted:['tag-cyan',  'Needs Review'],
    approved:         ['tag-green', 'Approved'],
    rejected:         ['tag-red',   'Rejected'],
    expired:          ['tag-dim',   'Expired'],
    suspended:        ['tag-red',   'Suspended'],
    cancelled:        ['tag-dim',   'Cancelled'],
    banned:           ['tag-red',   'Banned'],
    verified:         ['tag-green', 'Verified'],
  };
  const [cls, label] = map[status] || ['tag-dim', status || '—'];
  return <span className={`tag ${cls}`}>{label}</span>;
}

export function Skeleton({ className = '' }) {
  return <div className={`bg-surface2 rounded-sm animate-pulse ${className}`} />;
}

export function ConfirmButton({ children, onConfirm, variant = 'ghost', confirmText = 'Are you sure?' }) {
  // a two-click confirm pattern implemented inline
  return (
    <button
      onClick={(e) => {
        const el = e.currentTarget;
        if (el.dataset.armed === '1') { onConfirm(); return; }
        el.dataset.armed = '1';
        const orig = el.innerHTML;
        el.innerHTML = `<span class="text-red">${confirmText}</span>`;
        setTimeout(() => { el.dataset.armed = '0'; el.innerHTML = orig; }, 3000);
      }}
      className={`btn ${variant === 'danger' ? 'btn-danger' : 'btn-ghost'}`}
    >
      {children}
    </button>
  );
}
