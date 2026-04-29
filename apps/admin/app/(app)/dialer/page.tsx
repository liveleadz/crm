import { PageHeader } from '@/components/page-header';
import { DialPad } from '@/components/dialer/dial-pad';

export default function DialerPage() {
  return (
    <>
      <PageHeader
        title="Dialer"
        subtitle="Browser-based outbound calling via SignalWire"
      />
      <div className="flex-1 overflow-auto p-6">
        <DialPad />
        <p className="mx-auto mt-4 max-w-sm text-center text-[11px] text-txt-3">
          Dialer wires through to the <code className="font-mono">startCall</code> server
          action. Add SignalWire credentials to enable real calls.
        </p>
      </div>
    </>
  );
}
