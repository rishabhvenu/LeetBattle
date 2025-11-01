import { createRequire as topLevelCreateRequire } from 'module';const require = topLevelCreateRequire(import.meta.url);import bannerUrl from 'url';const __dirname = bannerUrl.fileURLToPath(new URL('.', import.meta.url));

// open-next.config.ts
var cacheRegion = process.env.OPENNEXT_CACHE_REGION || "us-east-1";
var config = {
  default: {
    minifyHandlers: true,
    incrementalCache: {
      kind: "s3",
      s3BucketName: process.env.OPENNEXT_CACHE_BUCKET,
      s3Region: cacheRegion
    },
    tagCache: {
      kind: "s3",
      s3Region: cacheRegion
    }
  },
  imageOptimization: {
    runtime: "nodejs20.x",
    memory: 1024,
    timeout: 10
  }
};
var open_next_config_default = config;
export {
  open_next_config_default as default
};
