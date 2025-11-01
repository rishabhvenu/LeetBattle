const cacheRegion = process.env.OPENNEXT_CACHE_REGION || "us-east-1";

// OpenNext config type - matches open-next structure
interface OpenNextConfig {
  default?: {
    override?: {
      wrapper?: string;
      converter?: string;
      incrementalCache?: {
        kind?: string;
        s3BucketName?: string;
        s3Region?: string;
      };
      tagCache?: {
        kind?: string;
        s3Region?: string;
      };
    };
    minifyHandlers?: boolean;
  };
  imageOptimization?: {
    runtime?: string;
    memory?: number;
    timeout?: number;
  };
}

const config: OpenNextConfig = {
  default: {
    override: {
      wrapper: "aws-lambda-streaming",
      converter: "aws-apigw-v2",
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
    minifyHandlers: true,
  },
  imageOptimization: {
    runtime: "nodejs20.x",
    memory: 1024,
    timeout: 10,
  },
};

export default config;
