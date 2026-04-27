import type { Metadata } from 'next';
import '@leadpilot/ui/globals.css';

export const metadata: Metadata = {
  title: 'LeadPilot Admin',
  description: 'LeadPilot USA — internal CRM for HomePro, Virgin Leads, Buyer Signals, Live Leads, HomePro Bids, Buyer Incentives.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-canvas text-txt antialiased">{children}</body>
    </html>
  );
}
