const cacheRegion = process.env.OPENNEXT_CACHE_REGION || "us-east-1";

// OpenNext config - simplified for Next.js 15 compatibility
const config = {
  default: {
    minifyHandlers: true,
    incrementalCache: {
      kind: "s3",
      s3BucketName: process.env.OPENNEXT_CACHE_BUCKET,
      s3Region: cacheRegion,
    },
    tagCache: {
      kind: "s3",
      s3Region: cacheRegion,
    },
  },
  imageOptimization: {
    runtime: "nodejs20.x",
    memory: 1024,
    timeout: 10,
  },
};

export default config;
