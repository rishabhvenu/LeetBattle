const cacheRegion = process.env.OPENNEXT_CACHE_REGION || "us-east-1";

// OpenNext config - using API Gateway v2 (safer than Function URLs)
export default {
  default: {
    override: {
      wrapper: "aws-lambda-streaming",
      converter: "aws-apigw-v2"
    },
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
    memory: 1536, 
    timeout: 10 
  },
};
