/** @jsxImportSource sst */
import { Bucket, NextjsSite } from "sst/constructs";

export default {
  config(_input) {
    return {
      name: "codeclashers",
      region: "us-east-1",
    };
  },
  stacks(app) {
    app.stack(function Site({ stack }) {
      // Create S3 bucket for avatars
      const avatarBucket = new Bucket(stack, "avatars", {
        name: `codeclashers-avatars-${stack.stage}`,
        cors: [
          {
            allowedHeaders: ["*"],
            allowedMethods: ["GET", "PUT", "POST", "DELETE"],
            allowedOrigins: ["*"], // Will be restricted to your domain later
            maxAge: "1 day",
          },
        ],
      });

      const site = new NextjsSite(stack, "site", {
        // Add your domain
        domain: {
          domainName: "leetbattle.net",
          domainAlias: "www.leetbattle.net", // Optional: for www redirect
        },
        // SST automatically loads from .env.production for production stage
        environment: {
          MONGODB_URI: process.env.MONGODB_URI!,
          NEXTAUTH_URL: process.env.NEXTAUTH_URL!,
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET!,
          NEXT_PUBLIC_COLYSEUS_HTTP_URL: process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL!,
          NEXT_PUBLIC_COLYSEUS_WS_URL: process.env.NEXT_PUBLIC_COLYSEUS_WS_URL!,
          S3_ENDPOINT: "", // Empty for native S3
          AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID!,
          AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY!,
          S3_BUCKET_NAME: avatarBucket.bucketName,
          AWS_REGION: process.env.AWS_REGION || "us-east-1",
          REDIS_HOST: process.env.REDIS_HOST!,
          REDIS_PORT: process.env.REDIS_PORT || "6379",
          REDIS_PASSWORD: process.env.REDIS_PASSWORD!,
          INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET!,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
        },
      });

      // Grant the site access to the avatar bucket
      avatarBucket.attachPermissions([site]);
      
      stack.addOutputs({
        SiteUrl: site.url,
        CustomDomain: site.customDomainUrl, // This will be https://leetbattle.net
        AvatarBucketName: avatarBucket.bucketName,
        AvatarBucketUrl: `https://${avatarBucket.bucketName}.s3.amazonaws.com`,
      });
    });
  },
};

