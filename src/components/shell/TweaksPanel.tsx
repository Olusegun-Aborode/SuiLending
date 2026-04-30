'use client';

import type { Aesthetic, Density, Theme } from './tweaks-context';

interface TweaksPanelProps {
  open: boolean;
  aesthetic: Aesthetic;
  theme: Theme;
  density: Density;
  onAestheticChange: (a: Aesthetic) => void;
  onThemeChange: (t: Theme) => void;
  onDensityChange: (d: Density) => void;
  onClose: () => void;
}

/**
 * TweaksPanel — floating panel that lets operators switch aesthetic / theme /
 * density on the fly. All three write to <body> data-attrs so the CSS tokens
 * re-cascade immediately.
 */
export default function TweaksPanel({
  open,
  aesthetic,
  theme,
  density,
  onAestheticChange,
  onThemeChange,
  onDensityChange,
  onClose,
}: TweaksPanelProps) {
  if (!open) return null;
  return (
    <div className="tweaks" role="dialog" aria-label="Dashboard tweaks">
      <div className="tweaks-header">
        <span className="tweaks-title">Tweaks</span>
        <button className="close-btn" onClick={onClose} type="button" aria-label="Close tweaks">
          ✕
        </button>
      </div>
      <div className="tweaks-body">
        <div className="tweak-row">
          <div className="tweak-label">Aesthetic</div>
          <div className="tweak-seg" style={{ flexDirection: 'column', gap: 0 }}>
            {(
              [
                { id: 'refined', label: 'Refined TUI' },
                { id: 'evolved', label: 'Terminal → Analytics' },
                { id: 'modern', label: 'Modern Analytics' },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                className={aesthetic === o.id ? 'active' : ''}
                onClick={() => onAestheticChange(o.id)}
                style={{ textAlign: 'left', padding: '8px 10px' }}
                type="button"
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="tweak-row">
          <div className="tweak-label">Theme</div>
          <div className="tweak-seg">
            <button
              className={theme === 'light' ? 'active' : ''}
              onClick={() => onThemeChange('light')}
              type="button"
            >
              Light
            </button>
            <button
              className={theme === 'dark' ? 'active' : ''}
              onClick={() => onThemeChange('dark')}
              type="button"
            >
              Dark
            </button>
          </div>
        </div>
        <div className="tweak-row">
          <div className="tweak-label">Density</div>
          <div className="tweak-seg">
            <button
              className={density === 'cozy' ? 'active' : ''}
              onClick={() => onDensityChange('cozy')}
              type="button"
            >
              Cozy
            </button>
            <button
              className={density === 'compact' ? 'active' : ''}
              onClick={() => onDensityChange('compact')}
              type="button"
            >
              Compact
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
