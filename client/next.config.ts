import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // OpenNext will handle the build output, no need for standalone mode
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
    domains: [
      'localhost',
      'leetbattle.net',
      'www.leetbattle.net',
      ...(process.env.S3_BUCKET_NAME 
        ? [`${process.env.S3_BUCKET_NAME}.s3.amazonaws.com`]
        : []
      ),
    ],
    unoptimized: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  webpack: (config, { isServer, webpack }) => {
    // Ignore infra directory completely - it's CDK infrastructure code, not part of Next.js app
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /infra($|\/)/,
      })
    );

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
