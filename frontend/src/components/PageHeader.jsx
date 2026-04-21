export function PageHeader({ title, subtitle, meta, actions, kicker }) {
  return (
    <header className="border-b border-border bg-bg relative">
      <div className="absolute inset-0 grid-overlay" />
      {/* pt-14 lg:pt-8 leaves room for the mobile hamburger at top-left */}
      <div className="relative px-4 md:px-8 pt-14 pb-6 lg:pt-8 lg:pb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="min-w-0 flex-1">
          {kicker && (
            <div className="text-mono text-[10px] text-amber uppercase tracking-[0.25em] mb-2">
              {kicker}
            </div>
          )}
          <h1 className="text-display text-3xl md:text-4xl lg:text-5xl leading-[1.05] break-words">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 md:mt-3 text-text-dim text-xs md:text-sm max-w-xl">{subtitle}</p>
          )}
          {meta && (
            <div className="mt-3 md:mt-4 flex flex-wrap items-center gap-3 md:gap-4 text-mono text-[10px] md:text-[11px] text-text-mute uppercase tracking-wider">
              {meta}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
