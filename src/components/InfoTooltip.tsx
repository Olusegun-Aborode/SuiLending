'use client';

import { HelpCircle } from 'lucide-react';

interface InfoTooltipProps {
  text: string;
}

export default function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <span className="group relative inline-flex cursor-help align-middle">
      <HelpCircle
        className="h-3.5 w-3.5"
        style={{ color: 'var(--text-muted)' }}
      />
      <span
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-[280px] -translate-x-1/2 rounded px-2.5 py-1.5 text-[10px] leading-relaxed group-hover:block"
        style={{
          backgroundColor: 'var(--card)',
          border: '1px solid var(--border-bright)',
          color: 'var(--foreground)',
        }}
      >
        {text}
      </span>
    </span>
  );
}
