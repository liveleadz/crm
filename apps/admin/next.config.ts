import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@leadpilot/ui', '@leadpilot/db', '@leadpilot/sip', '@leadpilot/workflows'],
  experimental: {
    typedRoutes: true,
  },
};

export default config;
