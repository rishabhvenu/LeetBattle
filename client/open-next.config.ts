const cacheRegion = process.env.CACHE_BUCKET_REGION || "us-east-1";

// OpenNext config - using API Gateway v2 (safer than Function URLs)
// Note: CACHE_BUCKET_NAME is set at runtime via Lambda environment variables
// (provided by CDK infrastructure). At build time, it may be undefined, which is fine
// as OpenNext will read it from process.env at runtime.
export default {
  default: {
    override: {
      wrapper: "aws-lambda-streaming",
      converter: "aws-apigw-v2"
    },
    minifyHandlers: true,
    incrementalCache: {
      kind: "s3",
      // Bucket name is provided at runtime via Lambda env vars (CACHE_BUCKET_NAME)
      // CDK creates the bucket and sets this env var automatically
      s3BucketName: process.env.CACHE_BUCKET_NAME,
      s3Region: cacheRegion,
    },
    tagCache: {
      kind: "s3",
      s3Region: cacheRegion,
    },
  },
  imageOptimization: { 
    runtime: "nodejs20.x", 
    memory: 1536, 
    timeout: 10 
  },
};
