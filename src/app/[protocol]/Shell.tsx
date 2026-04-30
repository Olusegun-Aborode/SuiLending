'use client';

import NaviShell from '@/components/shell/NaviShell';
import EmailGate from '@/components/shell/EmailGate';

interface ShellProps {
  protocol: string;
  protocolName: string;
  children: React.ReactNode;
}

export default function Shell({ protocol, protocolName, children }: ShellProps) {
  const sections = [
    {
      label: 'Terminals',
      items: [
        { href: `/${protocol}/overview`, label: 'Overview', icon: '◆' },
        { href: `/${protocol}/markets`, label: 'Markets', icon: '▦' },
        { href: `/${protocol}/liquidation`, label: 'Liquidation', icon: '▲' },
        { href: `/${protocol}/wallets`, label: 'Wallets', icon: '≈' },
      ],
    },
    {
      label: 'Workspace',
      items: [
        { href: `/${protocol}/methodology`, label: 'Methodology', icon: '§' },
      ],
    },
  ];

  return (
    <EmailGate
      dashboardName={`${protocolName} Lending Terminal`}
      features={[
        'Live liquidation feed',
        'Health-factor watchlist',
        'Per-asset risk metrics',
      ]}
    >
      <NaviShell protocol={protocol} protocolName={protocolName} sections={sections}>
        {children}
      </NaviShell>
    </EmailGate>
  );
}
