import type { NextConfig } from "next/dist/types";

const nextConfig: NextConfig = {
  experimental: {
    largePageDataBytes: 512 * 1000,
  },
  serverExternalPackages: ['better-sqlite3'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
};

export default nextConfig;
