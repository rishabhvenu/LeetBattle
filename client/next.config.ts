import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    turbo: {
      resolveAlias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  },
  // Enable server actions
  experimental: {
    serverActions: true,
  },
  // Environment variables for API routes
  env: {
    MONGODB_URI: process.env.MONGODB_URI,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  },
};

export default nextConfig;
