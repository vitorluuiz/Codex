import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Server Actions are used for room join / submissions so mutations stay on the server.
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
