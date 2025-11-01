import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone', // Required for serverless/Lambda deployment
  experimental: {
    serverActions: {
      allowedOrigins: process.env.NODE_ENV === 'production' 
        ? ['leetbattle.net', 'www.leetbattle.net'] 
        : ['localhost:3000'],
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
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
    // Exclude MongoDB from client bundle completely
    if (!isServer) {
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
      
      // Exclude mongodb package entirely from client bundle
      config.resolve.alias = {
        ...config.resolve.alias,
        mongodb: false,
        'mongodb/lib/cmap/auth/mongodb_oidc/callback_workflow.js': false,
      };
    }
    
    // For server-side, ensure proper resolution
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('mongodb');
    }
    
    return config;
  },
};

export default nextConfig;
