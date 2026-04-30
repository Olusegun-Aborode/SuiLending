/**
 * Loading — lightweight skeleton used in place of the kit's LoadingState.
 * Matches the boot-splash shimmer pattern from the SDK.
 */
export default function Loading({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="panel" style={{ padding: 24 }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--fg-muted)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 12,
        }}
      >
        <span className="live-pill">
          <span className="dot" /> {message}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 12,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 72,
              borderRadius: 'var(--panel-radius)',
              background: 'var(--bg-2)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(90deg, transparent 0%, var(--hover) 50%, transparent 100%)',
                animation: 'bsShimmer 1.4s linear infinite',
              }}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          height: 240,
          borderRadius: 'var(--panel-radius)',
          background: 'var(--bg-2)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, transparent 0%, var(--hover) 50%, transparent 100%)',
            animation: 'bsShimmer 1.6s linear infinite',
          }}
        />
      </div>
      <style>{`
        @keyframes bsShimmer {
          0%   { opacity: 0.6; transform: translateX(-100%); }
          100% { opacity: 0.6; transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
