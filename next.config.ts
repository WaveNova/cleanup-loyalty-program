import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SHADOW_MODE: process.env.SHADOW_MODE ?? 'false',
  },
};

export default nextConfig;
