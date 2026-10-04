import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // External packages for server components
  serverExternalPackages: ['mongoose'],

  // Turbopack configuration
  turbopack: {
    rules: {
      '*.mjs': {
        loaders: ['raw-loader'],
        as: '*.js',
      },
    },
  },

  // Webpack configuration (fallback for non-Turbopack builds)
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Handle PDF.js worker files
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },

  // Handle static files and security headers
  async headers() {
    return [
      {
        source: '/pdf.worker.min.mjs',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript',
          },
        ],
      },
      // Allow PDF viewer API to be embedded in iframes (same-origin only)
      {
        source: '/api/admin/pdf-viewer',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
      // Security headers for SEO and security
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },

  // Redirects for SEO (www/non-www handling)
  async redirects() {
    // Note: In production, handle www/non-www redirects at the DNS/hosting level (Vercel handles this automatically)
    // These redirects are here as a fallback
    return [];
  },
};

export default nextConfig;
