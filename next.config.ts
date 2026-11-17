import type { NextConfig } from "next";

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

const nextConfig: NextConfig = {
  // Required by the Dockerfile (copies .next/standalone)
  output: 'standalone',
  // Packages that must run as plain Node modules on the server
  serverExternalPackages: ['mongoose', 'pino'],
  // Non-Turbopack builds: keep Node built-ins out of client bundles
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
  async headers() {
    return [
      // The PDF viewer is embedded in same-origin iframes
      {
        source: '/api/admin/pdf-viewer',
        headers: [...securityHeaders, { key: 'X-Frame-Options', value: 'SAMEORIGIN' }],
      },
      // Everything else. The PDF viewer is excluded because, when two rules match,
      // Next applies the later one, and DENY would override SAMEORIGIN above.
      {
        source: '/((?!api/admin/pdf-viewer).*)',
        headers: [...securityHeaders, { key: 'X-Frame-Options', value: 'DENY' }],
      },
    ];
  },
};

export default nextConfig;
