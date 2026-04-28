import { PageHeader, StubBody } from '@/components/page-header';

export default function DialerPage() {
  return (
    <>
      <PageHeader title="Dialer" subtitle="Browser-based outbound calling" />
      <StubBody note="SignalWire Call Fabric SIP dialer lands in Sprint 1.4 (needs SignalWire credentials first)." />
    </>
  );
}
