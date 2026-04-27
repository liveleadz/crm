// SignalWire Call Fabric (SIP) browser dialer wrapper.
// Skeleton — full implementation lands in Sprint 1 alongside apps/admin dialer page.

export type DialerConfig = {
  token: string; // SignalWire SAT — minted server-side per agent.
  fromNumber: string; // E.164, must belong to active brand.
};

export type CallHandle = {
  id: string;
  hangup: () => Promise<void>;
  mute: (on: boolean) => Promise<void>;
  sendDigits: (digits: string) => Promise<void>;
};

export interface Dialer {
  connect(config: DialerConfig): Promise<void>;
  dial(toNumber: string, opts?: { brandId?: string }): Promise<CallHandle>;
  disconnect(): Promise<void>;
}
