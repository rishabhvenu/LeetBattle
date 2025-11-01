  // @ts-nocheck
  /// <reference path="./.sst/platform/config.d.ts" />

  export default $config({
    app(input) {
      return {
        name: "codeclashers",
        home: "aws",
      };
    },
    
    async run() {
      // Create S3 bucket for avatars
      const avatarBucket = new sst.aws.Bucket(process.env.S3_BUCKET_NAME || "avatars", {
        cors: [
          {
            allowedHeaders: ["*"],
            allowedMethods: ["GET", "PUT", "POST", "DELETE"],
            allowedOrigins: ["*"], // Will be restricted to your domain later
            maxAge: "1 day",
          },
        ],
      });

      const site = new sst.aws.Nextjs("site", {
        domain: {
          name: "leetbattle.net",
          aliases: ["www.leetbattle.net"],
        },
        environment: {
          MONGODB_URI: process.env.MONGODB_URI!,
          NEXTAUTH_URL: process.env.NEXTAUTH_URL!,
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET!,
          NEXT_PUBLIC_COLYSEUS_HTTP_URL: process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!,
          NEXT_PUBLIC_COLYSEUS_WS_URL: process.env.NEXT_PUBLIC_COLYSEUS_WS_URL!,
          S3_ENDPOINT: "",
          // AWS credentials and region are automatically provided by Lambda runtime - don't set them
          S3_BUCKET_NAME: avatarBucket.name,
          REDIS_HOST: process.env.REDIS_HOST!,
          REDIS_PORT: process.env.REDIS_PORT || "6379",
          REDIS_PASSWORD: process.env.REDIS_PASSWORD!,
          INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET!,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
          COLYSEUS_DOMAIN: process.env.COLYSEUS_DOMAIN || "",
          COLYSEUS_HOST_IP: process.env.COLYSEUS_HOST_IP || "",
        },
      });

      // Note: Route53 A record for Colyseus is created outside SST via AWS CLI in GitHub Actions
      
      return {
        siteUrl: site.url,
        bucketName: avatarBucket.name,
      };
    },
  });

