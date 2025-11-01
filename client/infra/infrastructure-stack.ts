import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for avatars
    const accountId = props?.env?.account || this.account || 'unknown';
    const region = props?.env?.region || this.region || 'us-east-1';
    const avatarBucket = new s3.Bucket(this, 'AvatarsBucket', {
      bucketName: process.env.S3_BUCKET_NAME || `codeclashers-avatars-${accountId}`,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE],
          allowedOrigins: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 86400,
        },
      ],
      // Block ACLs but allow bucket policies for public access
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS_ONLY, // ✅ correct constant
      publicReadAccess: false, // ✅ disables ACL-based public access
      removalPolicy: cdk.RemovalPolicy.RETAIN,
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

    // Get hosted zone for the domain
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

    // ===== Next.js Serverless Deployment =====
    
    // Build Next.js in standalone mode (if not already built)
    // Use import.meta.url for ESM or __dirname for CommonJS
    const currentDir = typeof __dirname !== 'undefined' ? __dirname : new URL('.', import.meta.url).pathname;
    const clientDir = join(currentDir, '..');
    const nextBuildDir = join(clientDir, '.next');
    const standaloneDir = join(nextBuildDir, 'standalone');
    
    // Only build if standalone output doesn't exist (to speed up CDK synth during development)
    // In CI/CD, Next.js should be built before CDK deployment
    if (!existsSync(standaloneDir)) {
      console.log('Building Next.js in standalone mode...');
      try {
        execSync('npm run build', { 
          cwd: clientDir, 
          stdio: 'inherit',
          env: { ...process.env, NODE_ENV: 'production' }
        });
      } catch (error) {
        console.warn('Next.js build failed or skipped. Ensure Next.js is built before CDK deployment.');
      }
    }

    // S3 bucket for Next.js static assets
    const staticAssetsBucket = new s3.Bucket(this, 'NextJsStaticAssetsBucket', {
      bucketName: process.env.NEXTJS_STATIC_BUCKET_NAME || `codeclashers-static-${accountId}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // Upload static assets from .next/static to S3
    const staticAssetsPath = join(nextBuildDir, 'static');
    if (existsSync(staticAssetsPath)) {
      new s3deploy.BucketDeployment(this, 'DeployNextJsStaticAssets', {
        sources: [s3deploy.Source.asset(staticAssetsPath)],
        destinationBucket: staticAssetsBucket,
        destinationKeyPrefix: '_next/static',
        prune: true,
      });
    }

    // Create Lambda function for Next.js server (SSR + API routes)
    const nextjsLambda = new lambdaNodejs.NodejsFunction(this, 'NextJsLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: join(currentDir, 'lambda-handler.ts'),
      bundling: {
        // Bundle the Lambda handler but don't bundle Next.js - it will be included as a layer
        externalModules: [],
        minify: true,
        sourceMap: true,
        // Copy the standalone build to the Lambda's /opt directory
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            const standalonePath = join(clientDir, '.next', 'standalone');
            if (existsSync(standalonePath)) {
              return [
                `cp -r ${standalonePath} ${outputDir}/.next/`,
              ];
            }
            return [];
          },
          afterBundling(): string[] {
            return [];
          },
          beforeInstall(): string[] {
            return [];
          },
        },
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      environment: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_PFP_BUCKET_URL: `https://${avatarBucket.bucketName}.s3.${region}.amazonaws.com/`,
        S3_BUCKET_NAME: avatarBucket.bucketName,
        // Note: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN are
        // automatically provided by Lambda runtime via IAM role - don't set them manually
        // Add all required environment variables
        MONGODB_URI: process.env.MONGODB_URI || '',
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || '',
        NEXTAUTH_URL: process.env.NEXTAUTH_URL || '',
        // AWS credentials are handled via IAM role (avatarBucket.grantReadWrite already configured)
        REDIS_HOST: process.env.REDIS_HOST || '',
        REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
        NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || '',
        NEXT_PUBLIC_COLYSEUS_HTTP_URL: process.env.NEXT_PUBLIC_COLYSEUS_HTTP_URL || '',
        NEXT_PUBLIC_COLYSEUS_WS_URL: process.env.NEXT_PUBLIC_COLYSEUS_WS_URL || '',
      },
    });

    // Grant Lambda permissions to access S3 bucket
    avatarBucket.grantReadWrite(nextjsLambda);
    staticAssetsBucket.grantRead(nextjsLambda);

    // Create Lambda Function URL for CloudFront to use
    const lambdaFunctionUrl = nextjsLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    });

    // CloudFront origin for static assets (S3)
    const staticOrigin = new cloudfrontOrigins.S3Origin(staticAssetsBucket);

    // CloudFront origin for Lambda (SSR + API)
    // Extract hostname from Lambda Function URL
    const lambdaUrlHost = lambdaFunctionUrl.url.replace('https://', '').split('/')[0];
    const lambdaOrigin = new cloudfrontOrigins.HttpOrigin(lambdaUrlHost, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // Determine domain names for Next.js app
    // Use NEXTJS_DOMAIN_NAME if provided, otherwise derive from hosted zone
    const nextDomainName = process.env.NEXTJS_DOMAIN_NAME || (hostedZone ? hostedZoneName : undefined);
    
    // Certificate and Route53 setup (only if hosted zone and domain are configured)
    let certificate: acm.ICertificate | undefined;
    const domainNames: string[] = [];

    if (hostedZone && nextDomainName) {
      // Determine all domain aliases (root domain and www subdomain)
      const rootDomain = nextDomainName.endsWith(`.${hostedZoneName}`)
        ? nextDomainName.replace(`.${hostedZoneName}`, '')
        : nextDomainName.includes('.')
        ? nextDomainName.split('.').slice(-2).join('.')
        : nextDomainName;
      
      const rootDomainFull = rootDomain === hostedZoneName ? hostedZoneName : `${rootDomain}.${hostedZoneName}`;
      const wwwDomain = `www.${hostedZoneName}`;
      
      // Add both root and www domains
      domainNames.push(rootDomainFull);
      if (wwwDomain !== rootDomainFull) {
        domainNames.push(wwwDomain);
      }

      // Create DNS-validated certificate in us-east-1 (required for CloudFront)
      // Note: CloudFront certificates MUST be in us-east-1
      // Using DnsValidatedCertificate which supports cross-region certificate creation
      // If the stack is not in us-east-1, this will create the certificate in us-east-1 automatically
      certificate = new acm.DnsValidatedCertificate(this, 'NextJsCertificate', {
        domainName: rootDomainFull,
        subjectAlternativeNames: domainNames.length > 1 ? domainNames.slice(1) : undefined,
        hostedZone: hostedZone,
        region: 'us-east-1', // CloudFront requires certificates in us-east-1
      });
    }

    // CloudFront distribution with proper cache behaviors
    const distribution = new cloudfront.Distribution(this, 'NextJsDistribution', {
      defaultBehavior: {
        origin: lambdaOrigin, // SSR handler (all routes except static assets)
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // No cache for SSR
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      additionalBehaviors: {
        // Static assets - heavily cached
        '_next/static/*': {
          origin: staticOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        'static/*': {
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
        },
        // Server actions endpoint - no cache
        '/_next/data/*': {
          origin: lambdaOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      },
      certificate: certificate,
      domainNames: domainNames.length > 0 ? domainNames : undefined,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultRootObject: 'index.html',
    });

    // Route53 A records for all domain aliases (aliasing to CloudFront)
    if (hostedZone && domainNames.length > 0) {
      domainNames.forEach((domain, index) => {
        // Extract relative record name (subdomain part)
        const relativeRecordName = domain.endsWith(`.${hostedZoneName}`)
          ? domain.slice(0, -(hostedZoneName.length + 1)) || '' // Empty string for root domain
          : domain;
        
        // For root domain, use empty string; for www, use 'www'
        const recordName = relativeRecordName === hostedZoneName ? '' : relativeRecordName;

        new route53.ARecord(this, `NextJsAliasRecord${index === 0 ? 'Root' : 'Www'}`, {
          zone: hostedZone,
          recordName: recordName,
          target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
          ttl: cdk.Duration.minutes(5),
        });
      });
    }

    // Outputs
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
    
    // Outputs
    new cdk.CfnOutput(this, 'AvatarBucketName', {
      value: avatarBucket.bucketName,
      description: 'S3 bucket for avatars',
    });

    new cdk.CfnOutput(this, 'AvatarBucketUrl', {
      value: avatarBucket.urlForObject(),
      description: 'URL for accessing avatars',
    });
  }
}
