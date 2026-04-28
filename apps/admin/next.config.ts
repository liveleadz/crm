import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@leadpilot/ui', '@leadpilot/db', '@leadpilot/sip', '@leadpilot/workflows'],
  typedRoutes: true,
  // Pin Next's workspace root to the leadpilot monorepo (suppresses lockfile-detection warning).
  outputFileTracingRoot: path.join(__dirname, '../..'),
};

export default config;
