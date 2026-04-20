export function PageHeader({ title, subtitle, meta, actions, kicker }) {
  return (
    <header className="border-b border-border bg-bg relative">
      <div className="absolute inset-0 grid-overlay" />
      <div className="relative px-8 py-8 flex items-end justify-between gap-4">
        <div>
          {kicker && (
            <div className="text-mono text-[10px] text-amber uppercase tracking-[0.25em] mb-2">
              {kicker}
            </div>
          )}
          <h1 className="text-display text-4xl md:text-5xl leading-none">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-3 text-text-dim text-sm max-w-xl">{subtitle}</p>
          )}
          {meta && (
            <div className="mt-4 flex items-center gap-4 text-mono text-[11px] text-text-mute uppercase tracking-wider">
              {meta}
            </div>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
