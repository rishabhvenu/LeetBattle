  // Modernized OpenNext + AWS CDK stack
  // Uses open-next.config.json to dynamically deploy Next.js serverless components
  // NOTE: Before deploying, run: npx open-next build

  import * as cdk from 'aws-cdk-lib';
  import * as s3 from 'aws-cdk-lib/aws-s3';
  import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
  import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
  import * as iam from 'aws-cdk-lib/aws-iam';
  import * as lambda from 'aws-cdk-lib/aws-lambda';
  import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
  import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
  import * as sns from 'aws-cdk-lib/aws-sns';
  import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
  import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
  import * as route53 from 'aws-cdk-lib/aws-route53';
  import * as targets from 'aws-cdk-lib/aws-route53-targets';
  import * as acm from 'aws-cdk-lib/aws-certificatemanager';
  import { Construct } from 'constructs';
  import { join } from 'path';
  import { existsSync, readFileSync } from 'fs';

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
    functions?: Record<string, {
      runtime?: string;
      memory?: number;
      timeout?: number;
    }>;
    imageOptimization?: {
      runtime?: string;
      memory?: number;
      timeout?: number;
    };
  }

  export class InfrastructureStack extends cdk.Stack {
    // Exported properties for use by other stacks (e.g., MonitoringStack)
    public readonly distributionId: string;
    public readonly nextjsLambdaArn: string;
    public readonly imageOptLambdaArn?: string;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
      super(scope, id, props);

      const accountId = props?.env?.account || this.account || 'unknown';
      const region = props?.env?.region || this.region || 'us-east-1';

      // Add tags for cost tracking and resource management
      cdk.Tags.of(this).add('Project', 'LeetBattle');
      cdk.Tags.of(this).add('Environment', 'production');
      cdk.Tags.of(this).add('ManagedBy', 'CDK');

      // Edge functions MUST be deployed in us-east-1
      // This will be checked before creating EdgeFunction (now optional with warning)

      // ===== S3 Buckets =====
      // Consistent naming: ${project}-${bucketType}-${region}

      // S3 bucket for avatars - using CloudFront/signed URLs instead of public access
      // If bucket name is provided, assume it exists and import it (don't try to create)
      // Only create new buckets if no name is provided (auto-generated unique name)
      const avatarBucketName = process.env.S3_BUCKET_NAME;
      
      let avatarBucket: s3.IBucket;
      if (avatarBucketName) {
        // Bucket name provided - assume it already exists, import it (don't try to create)
        // CloudFormation won't manage it, just references it
        avatarBucket = s3.Bucket.fromBucketName(this, 'AvatarsBucket', avatarBucketName);
      } else {
        // No explicit name - let CDK auto-generate unique name and create it
        // This is safe because auto-generated names are globally unique
        avatarBucket = new s3.Bucket(this, 'AvatarsBucket', {
          cors: [
            {
              allowedHeaders: ['*'],
              allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE],
              allowedOrigins: ['*'],
              exposedHeaders: ['ETag'],
              maxAge: 86400,
            },
          ],
          // Secure: Block all public access - avatars accessed via CloudFront or signed URLs
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          publicReadAccess: false,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          autoDeleteObjects: false,
          // Lifecycle rule to transition old avatars to cheaper storage
          lifecycleRules: [
            {
              id: 'TransitionOldAvatars',
              transitions: [
                {
                  storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                  transitionAfter: cdk.Duration.days(90),
                },
              ],
            },
          ],
        });
      }

      // S3 bucket for Next.js static assets (OpenNext assets)
      // If bucket name is provided, assume it exists and import it (don't try to create)
      // Only create new buckets if no name is provided (auto-generated unique name)
      // Accessed via CloudFront with OAC (Origin Access Control) - no public access needed
      const staticBucketName = process.env.NEXTJS_STATIC_BUCKET_NAME;
      
      let staticAssetsBucket: s3.IBucket;
      if (staticBucketName) {
        // Bucket name provided - assume it already exists, import it (don't try to create)
        // CloudFormation won't manage it, just references it
        staticAssetsBucket = s3.Bucket.fromBucketName(this, 'NextJsStaticAssetsBucket', staticBucketName);
      } else {
        // No explicit name - let CDK auto-generate unique name and create it
        // This is safe because auto-generated names are globally unique
        staticAssetsBucket = new s3.Bucket(this, 'NextJsStaticAssetsBucket', {
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          autoDeleteObjects: false,
        });
      }

      // S3 bucket for OpenNext incremental cache
      // Always managed by CDK - automatically created and managed for Next.js ISR caching
      const cacheBucket = new s3.Bucket(this, 'NextCacheBucket', {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        lifecycleRules: [
          {
            id: 'CleanupOldCache',
            expiration: cdk.Duration.days(30),
          },
        ],
      });

      // DynamoDB table for OpenNext tag cache (revalidateTag/revalidatePath)
      // Required even for dynamodb-lite mode - OpenNext expects this env var to be set
      // Note: dynamodb-lite uses in-memory cache but still requires the table name for initialization
      const tagCacheTable = new dynamodb.Table(this, 'NextJsTagCache', {
        tableName: `${this.stackName.toLowerCase()}-tag-cache`,
        partitionKey: { name: 'path', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'tag', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // Pay per request - minimal cost
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        timeToLiveAttribute: 'ttl', // Optional: enable TTL for automatic cleanup
      });

      // Add Global Secondary Index (GSI) required by OpenNext for revalidation queries
      // This index allows querying by path and revalidatedAt timestamp
      tagCacheTable.addGlobalSecondaryIndex({
        indexName: 'revalidate',
        partitionKey: { name: 'path', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'revalidatedAt', type: dynamodb.AttributeType.NUMBER },
      });

      // S3 bucket for CloudFront logs
      // CloudFront logs require ACLs to be enabled (legacy requirement)
      const cloudFrontLogsBucket = new s3.Bucket(this, 'CloudFrontLogs', {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED, // Required for CloudFront logs (ACLs)
        lifecycleRules: [
          {
            expiration: cdk.Duration.days(90),
          },
        ],
      });

      // ===== Route53 Configuration =====

      const route53HostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
      const hostedZoneName = process.env.ROUTE53_HOSTED_ZONE_NAME || 'leetbattle.net';
      const hostedZone = route53HostedZoneId
        ? route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
            zoneName: hostedZoneName,
            hostedZoneId: route53HostedZoneId,
          })
        : undefined;

      // Create A record for Colyseus if configured
      if (hostedZone && process.env.COLYSEUS_DOMAIN && process.env.COLYSEUS_HOST_IP) {
        new route53.ARecord(this, 'ColyseusARecord', {
          zone: hostedZone,
          recordName: `${process.env.COLYSEUS_DOMAIN}.leetbattle.net`,
          target: route53.RecordTarget.fromIpAddresses(process.env.COLYSEUS_HOST_IP),
          ttl: cdk.Duration.minutes(5),
        });
      }

      // ===== OpenNext Integration =====

      const currentDir = __dirname;
      const clientDir = join(currentDir, '..');
      const openNextDir = join(clientDir, '.open-next');

      // Verify OpenNext build exists
      if (!existsSync(openNextDir)) {
        throw new Error(
          `OpenNext build not found at ${openNextDir}. ` +
          `Please run 'npx open-next build' before deploying.`
        );
      }

      // Parse OpenNext config if it exists
      let openNextConfig: OpenNextConfig | null = null;
      const configPath = join(openNextDir, 'open-next.config.json');
      if (existsSync(configPath)) {
        try {
          const configContent = readFileSync(configPath, 'utf-8');
          openNextConfig = JSON.parse(configContent) as OpenNextConfig;
        } catch (error) {
          // Config file exists but couldn't parse - use defaults
        }
      }

      // OpenNext output paths - OpenNext v3 uses server-functions/default/
      // Check for both old (v2) and new (v3) structure
      let serverFunctionPath = join(openNextDir, 'server-functions', 'default');
      if (!existsSync(serverFunctionPath)) {
        // Fallback to v2 structure
        serverFunctionPath = join(openNextDir, 'server-function');
        if (!existsSync(serverFunctionPath)) {
          throw new Error(
            `OpenNext server function not found. ` +
            `Checked: ${join(openNextDir, 'server-functions', 'default')} and ${serverFunctionPath}. ` +
            `Please run 'npx open-next build' before deploying.`
          );
        }
      }
      
      const imageOptimizationPath = join(openNextDir, 'image-optimization-function');
      
      // Middleware path - OpenNext v3 might use different structure
      // Check for v3 structure first (.build directory or middleware-function)
      let middlewarePath = join(openNextDir, 'middleware-function');
      if (!existsSync(middlewarePath)) {
        // OpenNext v3 might not have a separate middleware-function directory
        // Check if .build exists (contains middleware.mjs)
        const buildDir = join(openNextDir, '.build');
        if (existsSync(buildDir)) {
          // If .build exists but no middleware-function, middleware might be inline
          // For now, we'll skip edge function if no middleware-function directory
          middlewarePath = '';
        }
      }
      
      const assetsPath = join(openNextDir, 'assets');

      // Verify required paths exist and contain files
      if (!existsSync(assetsPath)) {
        throw new Error(
          `OpenNext assets directory not found at ${assetsPath}. ` +
          `Please run 'npx open-next build' before deploying.`
        );
      }
      
      // Check if assets directory has content (readdirSync will throw if not a directory)
      try {
        const assetsFiles = require('fs').readdirSync(assetsPath);
        if (assetsFiles.length === 0) {
          console.warn(`Warning: Assets directory at ${assetsPath} is empty. Skipping static asset deployment.`);
        }
      } catch (error) {
        throw new Error(
          `OpenNext assets directory at ${assetsPath} is not accessible or is not a directory. ` +
          `Please run 'npx open-next build' before deploying.`
        );
      }

      // ===== Lambda Functions =====

      // Main server function (required)
      // 
      // ⚠️ CRITICAL: OpenNext Cache Configuration Issue
      // OpenNext reads cache config (tagCache.kind, incrementalCache.kind) from open-next.config.ts
      // at BUILD TIME and embeds it directly into the Lambda bundle code.
      // Environment variables (INCREMENTAL_CACHE_KIND, TAG_CACHE_KIND) do NOT override this!
      //
      // If you see DynamoDB "TableName: undefined" errors, the Lambda was built with old artifacts
      // that have the wrong cache config embedded. The solution is:
      // 1. Ensure open-next.config.ts has tagCache: { kind: "dynamodb-lite" }
      // 2. Trigger a fresh build workflow (frontend-build.yml) to create new artifacts
      // 3. The deploy workflow will verify the config and deploy fresh artifacts
      // 
      // Simply redeploying CDK won't help - you MUST rebuild OpenNext first!
      //
      const nextjsLambda = new lambda.Function(this, 'NextJsLambda', {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(serverFunctionPath),
        timeout: cdk.Duration.seconds(60),
        memorySize: 2048,
        // Removed reservedConcurrentExecutions - timeout fixes prevent hanging, no need to limit concurrency
        environment: {
          NODE_ENV: 'production',
          // Avatar bucket name for internal Lambda operations
          S3_BUCKET_NAME: avatarBucket.bucketName,
          // AWS S3 configuration (IAM role used for credentials in Lambda, no explicit keys needed)
          // Note: AWS_REGION is automatically set by Lambda runtime - do not set manually
          // S3_ENDPOINT: Only set for MinIO or S3-compatible services (NOT AWS S3)
          // For AWS S3, leave empty/undefined - SDK automatically determines endpoint from region
          S3_ENDPOINT: process.env.S3_ENDPOINT || undefined,
          // MongoDB connection string (must include credentials)
          MONGODB_URI: process.env.MONGODB_URI || '',
          // Next.js Authentication
          NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || '',
          AUTH_TRUST_HOST: 'true',
          NEXTAUTH_URL: 'https://leetbattle.net',
          // Redis configuration
          REDIS_HOST: process.env.REDIS_HOST || '',
          REDIS_PORT: process.env.REDIS_PORT || '6379',
          REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
          // Redis Cluster configuration
          // Default to 'false' - only enable cluster mode if explicitly set
          // Cluster mode requires proper cluster initialization and node discovery
          REDIS_CLUSTER_ENABLED: process.env.REDIS_CLUSTER_ENABLED || 'false',
          // Optional: Comma-separated list of cluster nodes (e.g., "node1:6379,node2:6379")
          // If not set, uses REDIS_HOST:REDIS_PORT as entry point
          REDIS_CLUSTER_NODES: process.env.REDIS_CLUSTER_NODES || '',
          // Colyseus backend URLs
          NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || '',
          NEXT_PUBLIC_COLYSEUS_HTTP_URL: process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || '',
          NEXT_PUBLIC_COLYSEUS_WS_URL: process.env.NEXT_PUBLIC_COLYSEUS_WS_URL || '',
          // Internal service authentication (REQUIRED for protected endpoints)
          INTERNAL_SERVICE_SECRET: process.env.INTERNAL_SERVICE_SECRET || '',
          // OpenNext cache configuration
          CACHE_BUCKET_NAME: cacheBucket.bucketName,
          CACHE_BUCKET_REGION: region,
          // DynamoDB table for tag cache (required even for dynamodb-lite mode)
          CACHE_DYNAMO_TABLE: tagCacheTable.tableName,
          // Force OpenNext to use S3 for incremental cache (ISR)
          INCREMENTAL_CACHE_KIND: 's3',
          // Use dynamodb-lite for tag cache (in-memory, no persistence between cold starts)
          // Note: Even dynamodb-lite requires CACHE_DYNAMO_TABLE to be set
          TAG_CACHE_KIND: 'dynamodb-lite',
        },
        description: 'Next.js server function (generated by OpenNext)',
      });

      // Image optimization function (optional)
      // Uses Sharp library which benefits from higher memory allocation
      let imageOptimizationLambda: lambda.Function | undefined;
      if (existsSync(imageOptimizationPath)) {
        const imageOptConfig = openNextConfig?.imageOptimization || {};
        imageOptimizationLambda = new lambda.Function(this, 'NextJsImageOptimization', {
          runtime: lambda.Runtime.NODEJS_20_X,
          handler: 'index.handler',
          code: lambda.Code.fromAsset(imageOptimizationPath),
          timeout: cdk.Duration.seconds(imageOptConfig.timeout || 10),
          // Increased to 1536 MB for better Sharp performance (default 1024 MB is low)
          memorySize: imageOptConfig.memory || 1536,
          environment: {
            NODE_ENV: 'production',
          },
          description: 'Next.js image optimization (generated by OpenNext)',
        });
      }

      // Middleware function (optional, Lambda@Edge)
      // Lambda@Edge MUST be deployed in us-east-1 - optional with warning if not
      let edgeFunction: cloudfront.experimental.EdgeFunction | undefined;
      if (middlewarePath && existsSync(middlewarePath)) {
        if (region !== 'us-east-1') {
          // Warning instead of error - allows deployment in other regions (without Edge function)
          console.warn(`⚠️  WARNING: Lambda@Edge functions must be deployed in us-east-1, but current region is ${region}. Skipping Edge function deployment.`);
        } else {
          edgeFunction = new cloudfront.experimental.EdgeFunction(this, 'NextEdgeFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(middlewarePath),
            memorySize: 128,
            timeout: cdk.Duration.seconds(5),
            description: 'Next.js middleware (generated by OpenNext)',
          });
        }
      }

      // ===== IAM Permissions =====

      avatarBucket.grantReadWrite(nextjsLambda);
      staticAssetsBucket.grantRead(nextjsLambda);
      cacheBucket.grantReadWrite(nextjsLambda);
      // Grant read/write permissions to DynamoDB tag cache table
      tagCacheTable.grantReadWriteData(nextjsLambda);

      if (imageOptimizationLambda) {
        staticAssetsBucket.grantRead(imageOptimizationLambda);
        cacheBucket.grantReadWrite(imageOptimizationLambda);
      }

      // ===== Lambda Function URL =====
      // Function URL with streaming for Next.js serverless deployment
      const functionUrl = nextjsLambda.addFunctionUrl({
        authType: lambda.FunctionUrlAuthType.NONE,
        invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      });

      // Grant CloudFront permission to invoke the Function URL
      // CloudFront needs explicit permission even though the Function URL has authType.NONE
      // Without this, CloudFront gets 403 AccessDeniedException when trying to invoke
      nextjsLambda.addPermission('AllowCloudFrontInvoke', {
        action: 'lambda:InvokeFunctionUrl',
        principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
        functionUrlAuthType: lambda.FunctionUrlAuthType.NONE,
      });

      // ===== CloudFront Origins =====

      // Modern approach: S3Origin automatically uses OAC (Origin Access Control) 
      // when originAccessIdentity is not provided (replaces deprecated OAI)
      // Note: Deprecation warning may appear, but OAC is used automatically
      const staticOrigin = new cloudfrontOrigins.S3Origin(staticAssetsBucket);

      // Lambda Function URL origin for Next.js server function
      // Extract domain from Function URL: https://<id>.lambda-url.<region>.on.aws/
      const functionUrlParts = cdk.Fn.split('://', functionUrl.url);
      const functionUrlHostAndPath = cdk.Fn.select(1, functionUrlParts);
      const functionUrlDomain = cdk.Fn.select(0, cdk.Fn.split('/', functionUrlHostAndPath));

      // Determine the public domain name for custom headers
      // CloudFront blocks 'host' as a custom header, but we can set x-forwarded-host
      // Next.js checks x-forwarded-host to determine the original host
      const publicDomain = process.env.NEXTJS_DOMAIN_NAME || hostedZoneName || 'leetbattle.net';

      const lambdaOrigin = new cloudfrontOrigins.HttpOrigin(functionUrlDomain, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        connectionTimeout: cdk.Duration.seconds(10),  // Connection timeout
        readTimeout: cdk.Duration.seconds(60),  // Match Lambda timeout (60s) - CloudFront origin timeout
        customHeaders: {
          // Set x-forwarded-host so Next.js knows the original public domain
          // This helps Next.js generate correct URLs and prevents redirect issues
          // Note: CloudFront does not allow 'host' as a custom header
          'x-forwarded-host': publicDomain,
        },
      });

      // Image optimization origin (if function exists)
      // Note: Image optimization can use Function URL (simpler for this use case)
      let imageOptOrigin: cloudfrontOrigins.HttpOrigin | undefined;
      if (imageOptimizationLambda) {
        const imageOptFunctionUrl = imageOptimizationLambda.addFunctionUrl({
          authType: lambda.FunctionUrlAuthType.NONE,
        });

        const imageOptUrlParts = cdk.Fn.split('://', imageOptFunctionUrl.url);
        const imageOptHostAndPath = cdk.Fn.select(1, imageOptUrlParts);
        const imageOptDomain = cdk.Fn.select(0, cdk.Fn.split('/', imageOptHostAndPath));

        imageOptOrigin = new cloudfrontOrigins.HttpOrigin(imageOptDomain, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        });
      }

      // ===== Certificate and Domain Setup =====

      const nextDomainName = process.env.NEXTJS_DOMAIN_NAME || (hostedZone ? hostedZoneName : undefined);
      let certificate: acm.ICertificate | undefined;
      const domainNames: string[] = [];

      if (hostedZone && nextDomainName) {
        const rootDomain = nextDomainName.endsWith(`.${hostedZoneName}`)
          ? nextDomainName.replace(`.${hostedZoneName}`, '')
          : nextDomainName.includes('.')
          ? nextDomainName.split('.').slice(-2).join('.')
          : nextDomainName;

        const rootDomainFull = rootDomain === hostedZoneName ? hostedZoneName : `${rootDomain}.${hostedZoneName}`;
        const wwwDomain = `www.${hostedZoneName}`;

        domainNames.push(rootDomainFull);
        if (wwwDomain !== rootDomainFull) {
          domainNames.push(wwwDomain);
        }

        // CloudFront certificates MUST be in us-east-1
        // Since the stack is deployed in us-east-1, the certificate will be created there
        certificate = new acm.Certificate(this, 'NextJsCertificate', {
          domainName: rootDomainFull,
          subjectAlternativeNames: domainNames.length > 1 ? domainNames.slice(1) : undefined,
          validation: acm.CertificateValidation.fromDns(hostedZone),
        });
      }

      // ===== CloudFront Distribution =====

      // Default behavior configuration
      const defaultBehaviorConfig: cloudfront.BehaviorOptions = {
        origin: lambdaOrigin,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
        ...(edgeFunction ? {
          edgeLambdas: [
            {
              functionVersion: edgeFunction.currentVersion,
              eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
            },
          ],
        } : {}),
      };

      // Additional behaviors
      const additionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {
        // Static assets - heavily cached
        '_next/static/*': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        // Root-level static files from public/ directory - route to S3
        // These patterns match files like /logo.png, /sword-left.svg, etc.
        '/*.png': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        '/*.svg': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        '/*.jpg': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        '/*.jpeg': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        '/*.gif': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        '/*.webp': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        '/*.wav': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        '/*.mp3': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        '/favicon.ico': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        '/robots.txt': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        // API routes - no cache
        '/api/*': {
          origin: lambdaOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        // Server actions endpoint - no cache
        '/_next/data/*': {
          origin: lambdaOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      };

      // Image optimization behavior (if function exists)
      if (imageOptOrigin) {
        additionalBehaviors['/_next/image'] = {
          origin: imageOptOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        };
      }

      const distribution = new cloudfront.Distribution(this, 'NextJsDistribution', {
        defaultBehavior: defaultBehaviorConfig,
        comment: 'Next.js serverless deployment (OpenNext)',
        additionalBehaviors,
        certificate: certificate,
        domainNames: domainNames.length > 0 ? domainNames : undefined,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        enableLogging: true,
        logBucket: cloudFrontLogsBucket,
        logFilePrefix: 'cloudfront-logs/',
        // NOTE: Do not set defaultRootObject as it breaks SSR routing
      });

      // Export properties for use by other stacks (e.g., MonitoringStack)
      // Note: These are set after resource creation but can be referenced by other stacks
      this.distributionId = distribution.distributionId;
      this.nextjsLambdaArn = nextjsLambda.functionArn;
      if (imageOptimizationLambda) {
        this.imageOptLambdaArn = imageOptimizationLambda.functionArn;
      }

      // Note: NEXT_PUBLIC_CLOUDFRONT_URL removed to avoid circular dependency
      // The dependency chain would be: Lambda → Function URL → CloudFront → Lambda (env var)
      // If you need the CloudFront URL in the app, set it as a build-time environment
      // variable or use the distribution domain name directly where needed.

      // ===== Static Asset Deployment =====
      // Note: BucketDeployment requires the bucket to exist before deployment
      // If using IMPORT_EXISTING_STATIC_BUCKET=true, ensure the bucket exists and is accessible

      if (existsSync(assetsPath)) {
        // Check if assets directory has content before deploying
        const assetsFiles = require('fs').readdirSync(assetsPath);
        if (assetsFiles.length > 0) {
          console.log(`Deploying ${assetsFiles.length} static assets from ${assetsPath} to ${staticAssetsBucket.bucketName}`);
          new s3deploy.BucketDeployment(this, 'DeployNextJsStaticAssets', {
            sources: [s3deploy.Source.asset(assetsPath)],
            destinationBucket: staticAssetsBucket,
            cacheControl: [
              s3deploy.CacheControl.maxAge(cdk.Duration.days(30)),
            ],
            prune: true,
            retainOnDelete: true,
            distribution: distribution,
            // Optimized: Only invalidate specific paths instead of everything
            // Reduces CloudFront invalidation costs and deployment time
            distributionPaths: [
              '/_next/static/*',       // Next.js static chunks
              '/favicon.ico',          // Favicon
              '/robots.txt',            // SEO robots file
              '/*.png',                 // PNG images (logo.png, etc.)
              '/*.svg',                 // SVG images (sword-left.svg, etc.)
              '/*.jpg',                 // JPEG images
              '/*.jpeg',                // JPEG images
              '/*.gif',                 // GIF images
              '/*.webp',                // WebP images
              '/*.wav',                 // WAV audio files
              '/*.mp3',                 // MP3 audio files
            ],
            // Add explicit error handling
            memoryLimit: 512,
          });
        } else {
          console.warn(`Skipping static asset deployment: ${assetsPath} is empty`);
        }
      } else {
        console.warn(`Skipping static asset deployment: ${assetsPath} does not exist`);
      }

      // ===== Route53 Records =====

      if (hostedZone && domainNames.length > 0) {
        domainNames.forEach((domain, index) => {
          const relativeRecordName = domain.endsWith(`.${hostedZoneName}`)
            ? domain.slice(0, -(hostedZoneName.length + 1)) || ''
            : domain;

          const recordName = relativeRecordName === hostedZoneName ? '' : relativeRecordName;

          new route53.ARecord(this, `NextJsAliasRecord${index === 0 ? 'Root' : 'Www'}`, {
            zone: hostedZone,
            recordName: recordName,
            target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
            // TTL is ignored for alias targets (AWS sets it automatically)
          });
        });
      }

      // ===== CloudWatch Alarms =====

      // Lambda Error Alarms
      const nextjsLambdaErrorAlarm = new cloudwatch.Alarm(this, 'NextJsLambdaErrors', {
        metric: nextjsLambda.metricErrors({
          period: cdk.Duration.minutes(5),
          statistic: cloudwatch.Statistic.SUM,
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmName: 'LeetBattle-NextJsLambda-Errors',
        alarmDescription: 'Alert when Next.js Lambda function has errors',
      });

      if (imageOptimizationLambda) {
        const imageOptErrorAlarm = new cloudwatch.Alarm(this, 'NextJsImageOptErrors', {
          metric: imageOptimizationLambda.metricErrors({
            period: cdk.Duration.minutes(5),
            statistic: cloudwatch.Statistic.SUM,
          }),
          threshold: 1,
          evaluationPeriods: 1,
          alarmName: 'LeetBattle-ImageOptLambda-Errors',
          alarmDescription: 'Alert when image optimization Lambda function has errors',
        });
      }

      // CloudFront 5XX Error Rate Alarm
      const cloudfront5xxAlarm = new cloudwatch.Alarm(this, 'CloudFront5xxErrors', {
        metric: distribution.metric5xxErrorRate({
          period: cdk.Duration.minutes(5),
          statistic: cloudwatch.Statistic.AVERAGE,
        }),
        threshold: 1, // 1% error rate
        evaluationPeriods: 2,
        alarmName: 'LeetBattle-CloudFront-5xx-ErrorRate',
        alarmDescription: 'Alert when CloudFront 5XX error rate exceeds 1%',
      });

      // Export alarm ARNs for monitoring integration
      new cdk.CfnOutput(this, 'NextJsLambdaErrorAlarmArn', {
        value: nextjsLambdaErrorAlarm.alarmArn,
        description: 'CloudWatch alarm ARN for Next.js Lambda errors',
      });

      new cdk.CfnOutput(this, 'CloudFront5xxErrorAlarmArn', {
        value: cloudfront5xxAlarm.alarmArn,
        description: 'CloudWatch alarm ARN for CloudFront 5XX errors',
      });

      // ===== CloudFormation Outputs =====

      new cdk.CfnOutput(this, 'NextJsDistributionId', {
        value: distribution.distributionId,
        description: 'CloudFront distribution ID',
      });

      new cdk.CfnOutput(this, 'NextJsDistributionUrl', {
        value: `https://${distribution.distributionDomainName}`,
        description: 'CloudFront distribution URL',
      });

      new cdk.CfnOutput(this, 'NextJsLambdaFunctionArn', {
        value: nextjsLambda.functionArn,
        description: 'Next.js Lambda function ARN',
      });

      new cdk.CfnOutput(this, 'NextJsFunctionUrl', {
        value: functionUrl.url,
        description: 'Lambda Function URL for Next.js server function',
      });

      new cdk.CfnOutput(this, 'NextJsStaticBucketName', {
        value: staticAssetsBucket.bucketName,
        description: 'S3 bucket for Next.js static assets',
      });

      new cdk.CfnOutput(this, 'NextJsCacheBucketName', {
        value: cacheBucket.bucketName,
        description: 'S3 bucket for Next.js incremental cache (managed by CDK)',
      });

      if (certificate) {
        new cdk.CfnOutput(this, 'NextJsCertificateArn', {
          value: certificate.certificateArn,
          description: 'ACM certificate ARN for Next.js CloudFront distribution',
        });
      }

      if (domainNames.length > 0) {
        new cdk.CfnOutput(this, 'NextJsDomainNames', {
          value: domainNames.join(', '),
          description: 'Domain names configured for Next.js app',
        });
      }

      if (edgeFunction) {
        new cdk.CfnOutput(this, 'NextJsEdgeFunctionArn', {
          value: edgeFunction.functionArn,
          description: 'Lambda@Edge function ARN for Next.js middleware',
        });
      }

      new cdk.CfnOutput(this, 'AvatarBucketName', {
        value: avatarBucket.bucketName,
        description: 'S3 bucket for avatars',
      });
    }
  }
