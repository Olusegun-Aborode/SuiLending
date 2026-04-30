import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Panel — the unit surface from the Datum Labs Dashboard SDK.
 *
 * `flush` removes body padding (use for tables / charts that hug the edges).
 * Set `actions` for chart toolbars / filters on the right of the header.
 */
export default function Panel({
  title,
  badge,
  actions,
  flush,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  return (
    <section className={`panel ${className ?? ''}`.trim()}>
      {(title || badge || actions) && (
        <div className="panel-header">
          <div className="panel-title">
            {title && (
              <>
                <span className="bullet">●</span>
                <span>{title}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {badge && <span className="panel-badge">{badge}</span>}
            {actions}
          </div>
        </div>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''} ${bodyClassName ?? ''}`.trim()}>
        {children}
      </div>
    </section>
  );
}
