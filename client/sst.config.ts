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
      // Temporarily removed domain - add after first deploy to get AWS nameservers
      // domain: {
      //   name: "leetbattle.net",
      //   aliases: ["www.leetbattle.net"],
      // },
      environment: {
        MONGODB_URI: process.env.MONGODB_URI!,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL!,
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET!,
        NEXT_PUBLIC_COLYSEUS_HTTP_URL: process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!,
        NEXT_PUBLIC_COLYSEUS_WS_URL: process.env.NEXT_PUBLIC_COLYSEUS_WS_URL!,
        S3_ENDPOINT: "",
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID!,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY!,
        S3_BUCKET_NAME: avatarBucket.name,
        AWS_REGION: process.env.AWS_REGION || "us-east-1",
        REDIS_HOST: process.env.REDIS_HOST!,
        REDIS_PORT: process.env.REDIS_PORT || "6379",
        REDIS_PASSWORD: process.env.REDIS_PASSWORD!,
        INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET!,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
      },
      transform: {
        distribution: {
          async onBeforeBuild() {
            // Grant site access to bucket
            return avatarBucket.attachPermissions({ policy: "readwrite" });
          },
        },
      },
    });

    return {
      siteUrl: site.url,
      customDomain: site.domain,
      bucketName: avatarBucket.name,
      bucketUrl: `https://${avatarBucket.name}.s3.amazonaws.com`,
    };
  },
});

