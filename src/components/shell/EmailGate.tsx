'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { Mail, ArrowRight } from 'lucide-react';

interface EmailGateProps {
  /** e.g. "NAVI Lending Terminal" */
  dashboardName: string;
  /** Bullet points shown in the features list */
  features: string[];
  /** API endpoint that POSTs { email } → Beehiiv (defaults to /api/subscribe) */
  subscribeEndpoint?: string;
  /** localStorage key used to persist the "unlocked" state */
  storageKey?: string;
  /** The dashboard itself — rendered blurred behind the modal until unlocked */
  children: React.ReactNode;
}

/**
 * EmailGate — split-card newsletter gate ported from the Datum Labs Dashboard
 * SDK (`styles.css` .gate-* rules). Blurs the dashboard behind a modal until
 * the user submits their email; remembers the unlock in localStorage.
 */
export default function EmailGate({
  dashboardName,
  features,
  subscribeEndpoint = '/api/subscribe',
  storageKey = 'datumlabs_unlocked',
  children,
}: EmailGateProps) {
  const [unlocked, setUnlocked] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    if (localStorage.getItem(storageKey) === 'true') {
      setUnlocked(true);
    }
  }, [storageKey]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(subscribeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Subscription failed. Please try again.');
      }

      localStorage.setItem(storageKey, 'true');
      setUnlocked(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  // Render nothing on the server — avoids leaking gated content in the HTML.
  if (!mounted) return null;
  if (unlocked) return <>{children}</>;

  return (
    <>
      {/* Blurred snapshot of the dashboard behind the modal */}
      <div
        aria-hidden
        style={{
          filter: 'blur(6px)',
          pointerEvents: 'none',
          userSelect: 'none',
          maxHeight: '100vh',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>

      <div className="gate-backdrop" role="dialog" aria-modal="true" aria-labelledby="gate-title">
        <div className="gate-card">
          {/* Left: preview side */}
          <div className="gate-preview">
            <div className="gate-preview-brand">
              <Image
                src="/branding/icon.png"
                alt="Datum Labs"
                width={24}
                height={24}
                style={{ borderRadius: 5 }}
              />
              <span>
                datum<span style={{ color: 'var(--orange)' }}>labs</span>
              </span>
            </div>
            <div className="gate-preview-terminal">Terminal preview</div>
            <div className="gate-preview-title">
              <span className="accent">NAVI</span> Protocol
              <br />
              Lending Analytics
            </div>

            <div className="gate-kpis">
              <div className="gate-kpi">
                <div className="gate-kpi-label">TVL</div>
                <div className="gate-kpi-value">$—</div>
                <div className="gate-kpi-delta up">live</div>
              </div>
              <div className="gate-kpi">
                <div className="gate-kpi-label">Borrowed</div>
                <div className="gate-kpi-value">$—</div>
                <div className="gate-kpi-delta">—</div>
              </div>
              <div className="gate-kpi">
                <div className="gate-kpi-label">Utilization</div>
                <div className="gate-kpi-value">—</div>
                <div className="gate-kpi-delta">—</div>
              </div>
              <div className="gate-kpi">
                <div className="gate-kpi-label">Liquidations 24h</div>
                <div className="gate-kpi-value">—</div>
                <div className="gate-kpi-delta">—</div>
              </div>
            </div>

            <div className="gate-spark">
              <svg viewBox="0 0 300 60" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="gate-spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF6B35" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#FF6B35" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M0 44 L30 38 L60 40 L90 30 L120 34 L150 22 L180 26 L210 16 L240 20 L270 10 L300 14 L300 60 L0 60 Z"
                  fill="url(#gate-spark-fill)"
                />
                <path
                  d="M0 44 L30 38 L60 40 L90 30 L120 34 L150 22 L180 26 L210 16 L240 20 L270 10 L300 14"
                  fill="none"
                  stroke="#FF6B35"
                  strokeWidth="1.5"
                />
              </svg>
            </div>

            <div className="gate-preview-foot">
              <span className="dot" />
              live on sui mainnet
            </div>
          </div>

          {/* Right: form side */}
          <div className="gate-form-side">
            <div className="gate-eyebrow">Request Access</div>
            <h2 id="gate-title" className="gate-title">
              {dashboardName}
            </h2>
            <p className="gate-sub">
              Join the Datum Labs newsletter to unlock the full dashboard — real-time
              liquidation feed, health-factor watchlist, and per-asset risk metrics.
            </p>

            {features.length > 0 && (
              <ul className="gate-features">
                {features.map((f) => (
                  <li key={f}>
                    <span className="tick">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className="gate-field">
                <Mail size={16} />
                <input
                  type="email"
                  className="gate-input"
                  placeholder="you@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  autoComplete="email"
                  required
                />
                <button type="submit" className="gate-submit" disabled={submitting}>
                  {submitting ? 'Unlocking…' : 'Unlock'}
                  {!submitting && <ArrowRight size={14} />}
                </button>
              </div>
              {error && (
                <div className="gate-err" role="alert">
                  <span>[ERR]</span>
                  <span>{error}</span>
                </div>
              )}
              <p className="gate-fine">
                We&apos;ll email you occasional product updates. Unsubscribe any time.
              </p>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
