import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@leadpilot/ui', '@leadpilot/db', '@leadpilot/sip', '@leadpilot/workflows'],
  typedRoutes: true,
  // Pin Next's workspace root to the leadpilot monorepo (suppresses lockfile-detection warning).
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: {
    serverActions: {
      // CSV import sends parsed rows to the importLeads server action.
      // Default cap is 1MB — a wide CSV (~750 rows × dozens of columns)
      // blows past it and the action rejects before reaching our
      // try/catch, surfacing as the generic "Server Components render"
      // error in production. 10MB covers realistic import sizes; the
      // wizard also trims unused columns before sending so the actual
      // payload is far smaller.
      bodySizeLimit: '10mb',
    },
  },
};

export default config;
