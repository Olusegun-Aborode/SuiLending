import { notFound } from 'next/navigation';
import { isValidProtocol, getProtocolConfig } from '@/protocols/registry';
import Shell from './Shell';

export default async function ProtocolLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ protocol: string }>;
}) {
  const { protocol } = await params;

  if (!isValidProtocol(protocol)) {
    notFound();
  }

  const config = getProtocolConfig(protocol);
  const protocolName = config?.shortName ?? config?.name ?? protocol.toUpperCase();

  return (
    <Shell protocol={protocol} protocolName={protocolName}>
      {children}
    </Shell>
  );
}
