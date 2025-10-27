import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '9000',
        pathname: '/codeclashers-avatars/**',
      },
    ],
    // Allow local images from public directory
    domains: ['localhost'],
    unoptimized: false,
  },
  // Environment variables for API routes
  env: {
    MONGODB_URI: process.env.MONGODB_URI,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Exclude Node.js modules from client-side bundle
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
        child_process: false,
        dns: false,
        timers: false,
        'timers/promises': false,
        'fs/promises': false,
      };
    }
    return config;
  },
};

export default nextConfig;
