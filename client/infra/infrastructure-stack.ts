// Modernized OpenNext + AWS CDK stack
// Uses open-next.config.json to dynamically deploy Next.js serverless components
// NOTE: Before deploying, run: npx open-next build

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
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
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const accountId = props?.env?.account || this.account || 'unknown';
    const region = props?.env?.region || this.region || 'us-east-1';

    // Edge functions MUST be deployed in us-east-1
    // This will be checked before creating EdgeFunction

    // ===== S3 Buckets =====

    // S3 bucket for avatars with public read access via bucket policy
    const avatarBucket = new s3.Bucket(this, 'AvatarsBucket', {
      bucketName: process.env.S3_BUCKET_NAME || `codeclashers-avatars-${accountId}-${region}`,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE],
          allowedOrigins: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 86400,
        },
      ],
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // Grant public read access via bucket policy (more secure than ACLs)
    avatarBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowPublicReadAccess',
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:GetObject'],
        resources: [`${avatarBucket.bucketArn}/*`],
      })
    );

    // S3 bucket for Next.js static assets (OpenNext assets)
    const staticAssetsBucket = new s3.Bucket(this, 'NextJsStaticAssetsBucket', {
      bucketName: process.env.NEXTJS_STATIC_BUCKET_NAME || `codeclashers-static-${accountId}-${region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // S3 bucket for OpenNext incremental cache
    // If OPENNEXT_CACHE_BUCKET env var points to existing bucket, import it
    // Otherwise, create new bucket (CDK will auto-generate unique name if name conflicts)
    const explicitCacheBucketName = process.env.OPENNEXT_CACHE_BUCKET;
    
    let cacheBucket: s3.IBucket;
    if (explicitCacheBucketName) {
      // Try to use the provided bucket name
      // If bucket already exists outside stack, import it; otherwise create it
      // Note: For existing buckets, set IMPORT_EXISTING_CACHE_BUCKET=true in env
      if (process.env.IMPORT_EXISTING_CACHE_BUCKET === 'true') {
        cacheBucket = s3.Bucket.fromBucketName(this, 'NextJsCacheBucket', explicitCacheBucketName);
      } else {
        cacheBucket = new s3.Bucket(this, 'NextJsCacheBucket', {
          bucketName: explicitCacheBucketName,
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          removalPolicy: cdk.RemovalPolicy.RETAIN,
          autoDeleteObjects: false,
        });
      }
    } else {
      // No explicit name - let CDK auto-generate unique name
      // This avoids conflicts with existing buckets
      cacheBucket = new s3.Bucket(this, 'NextJsCacheBucket', {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        autoDeleteObjects: false,
      });
    }

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

    // Verify required paths exist
    if (!existsSync(assetsPath)) {
      throw new Error(
        `OpenNext assets directory not found at ${assetsPath}. ` +
        `Please run 'npx open-next build' before deploying.`
      );
    }

    // ===== Lambda Functions =====

    // Main server function (required)
    const nextjsLambda = new lambda.Function(this, 'NextJsLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(serverFunctionPath),
      timeout: cdk.Duration.seconds(60),
      memorySize: 2048,
      environment: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_PFP_BUCKET_URL: `https://${avatarBucket.bucketName}.s3.${region}.amazonaws.com/`,
        S3_BUCKET_NAME: avatarBucket.bucketName,
        MONGODB_URI: process.env.MONGODB_URI || '',
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || '',
        NEXTAUTH_URL: process.env.NEXTAUTH_URL || '',
        REDIS_HOST: process.env.REDIS_HOST || '',
        REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
        NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || '',
        NEXT_PUBLIC_COLYSEUS_HTTP_URL: process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || '',
        NEXT_PUBLIC_COLYSEUS_WS_URL: process.env.NEXT_PUBLIC_COLYSEUS_WS_URL || '',
        OPENNEXT_CACHE_BUCKET: cacheBucket.bucketName,
        OPENNEXT_CACHE_REGION: region,
      },
      description: 'Next.js server function (generated by OpenNext)',
    });

    // Image optimization function (optional)
    let imageOptimizationLambda: lambda.Function | undefined;
    if (existsSync(imageOptimizationPath)) {
      const imageOptConfig = openNextConfig?.imageOptimization || {};
      imageOptimizationLambda = new lambda.Function(this, 'NextJsImageOptimization', {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(imageOptimizationPath),
        timeout: cdk.Duration.seconds(imageOptConfig.timeout || 10),
        memorySize: imageOptConfig.memory || 1024,
        environment: {
          NODE_ENV: 'production',
        },
        description: 'Next.js image optimization (generated by OpenNext)',
      });
    }

    // Middleware function (optional, Lambda@Edge)
    // Lambda@Edge MUST be deployed in us-east-1
    let edgeFunction: cloudfront.experimental.EdgeFunction | undefined;
    if (middlewarePath && existsSync(middlewarePath)) {
      if (region !== 'us-east-1') {
        throw new Error('Lambda@Edge must be deployed in us-east-1. Current region: ' + region);
      }

      edgeFunction = new cloudfront.experimental.EdgeFunction(this, 'NextEdgeFunction', {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(middlewarePath),
        memorySize: 128,
        timeout: cdk.Duration.seconds(5),
        description: 'Next.js middleware (generated by OpenNext)',
      });
    }

    // ===== IAM Permissions =====

    avatarBucket.grantReadWrite(nextjsLambda);
    staticAssetsBucket.grantRead(nextjsLambda);
    cacheBucket.grantReadWrite(nextjsLambda);

    if (imageOptimizationLambda) {
      staticAssetsBucket.grantRead(imageOptimizationLambda);
      cacheBucket.grantReadWrite(imageOptimizationLambda);
    }

    // ===== Lambda Function URLs =====

    const lambdaFunctionUrl = nextjsLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    });

    // ===== CloudFront Origins =====

    // Note: S3Origin is deprecated but still functional
    // Will need to migrate to S3BucketOrigin in future CDK versions
    const staticOrigin = new cloudfrontOrigins.S3Origin(staticAssetsBucket);

    // Extract Lambda Function URL domain for CloudFront origin
    const lambdaUrlString = lambdaFunctionUrl.url;
    const urlParts = cdk.Fn.split('://', lambdaUrlString);
    const hostAndPath = cdk.Fn.select(1, urlParts);
    const domainNameOnly = cdk.Fn.select(0, cdk.Fn.split('/', hostAndPath));

    const lambdaOrigin = new cloudfrontOrigins.HttpOrigin(domainNameOnly, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      httpPort: 443,
      httpsPort: 443,
    });

    // Image optimization origin (if function exists)
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
        httpPort: 443,
        httpsPort: 443,
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

    // ===== Static Asset Deployment =====

    if (existsSync(assetsPath)) {
      new s3deploy.BucketDeployment(this, 'DeployNextJsStaticAssets', {
        sources: [s3deploy.Source.asset(assetsPath)],
        destinationBucket: staticAssetsBucket,
        cacheControl: [
          s3deploy.CacheControl.maxAge(cdk.Duration.days(30)),
        ],
        prune: true,
        retainOnDelete: true,
        distribution: distribution,
        distributionPaths: ['/*'],
      });
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
          ttl: cdk.Duration.minutes(5),
        });
      });
    }

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

    new cdk.CfnOutput(this, 'NextJsStaticBucketName', {
      value: staticAssetsBucket.bucketName,
      description: 'S3 bucket for Next.js static assets',
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
