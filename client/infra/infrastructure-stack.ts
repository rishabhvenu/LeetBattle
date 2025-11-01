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

    // Check for edge runtime routes (not supported in Lambda)
    const edgeRuntimePath = join(nextBuildDir, 'server', 'edge-runtime');
    if (existsSync(edgeRuntimePath)) {
      console.warn('⚠️  WARNING: Next.js edge runtime routes detected!');
      console.warn('   Edge routes (export const runtime = "edge") are not supported in AWS Lambda.');
      console.warn('   These routes will fail at runtime. Consider using Node.js runtime instead.');
    }

    // S3 bucket for Next.js static assets
    const staticAssetsBucket = new s3.Bucket(this, 'NextJsStaticAssetsBucket', {
      bucketName: process.env.NEXTJS_STATIC_BUCKET_NAME || `codeclashers-static-${accountId}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // Static assets deployment will be created after distribution to enable cache invalidation

    // Create Lambda function for Next.js server (SSR + API routes)
    const nextjsLambda = new lambdaNodejs.NodejsFunction(this, 'NextJsLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: join(currentDir, 'lambda-handler.ts'),
      bundling: {
        // Bundle the Lambda handler but don't bundle Next.js dependencies
        // Next.js standalone build will be copied alongside the handler
        externalModules: [
          // Exclude Next.js and its dependencies from bundling - they're in standalone build
          'next',
          '@next/env',
          '@swc/helpers',
        ],
        minify: true,
        sourceMap: true,
        // Copy the entire Next.js standalone build to the Lambda package
        commandHooks: {
          beforeBundling(inputDir: string, outputDir: string): string[] {
            const standalonePath = join(clientDir, '.next', 'standalone');
            if (existsSync(standalonePath)) {
              // Copy ALL contents of standalone directory including hidden files/directories
              // Use rsync or cp with proper flags to include .next/ and other hidden dirs
              // This ensures server.js, .next/, node_modules/, public/ are all at /var/task/
              return [
                `echo "Copying Next.js standalone build from ${standalonePath} to ${outputDir}"`,
                `echo "Contents of standalone directory:"`,
                `ls -la ${standalonePath} || echo "Failed to list standalone directory"`,
                // Use tar to preserve all files including hidden directories like .next
                `cd ${standalonePath} && tar -cf - . | (cd ${outputDir} && tar -xf -) || {`,
                `  echo "Tar failed, trying rsync..."`,
                `  if command -v rsync &> /dev/null; then`,
                `    rsync -av --exclude='.git' ${standalonePath}/ ${outputDir}/ || exit 1`,
                `  else`,
                `    echo "Neither tar nor rsync available, using cp..."`,
                `    shopt -s dotglob || true`,
                `    cp -r ${standalonePath}/* ${outputDir}/ 2>/dev/null || true`,
                `    cp -r ${standalonePath}/.[!.]* ${outputDir}/ 2>/dev/null || true`,
                `  fi`,
                `}`,
                `echo "Verifying files after copy:"`,
                `ls -la ${outputDir}/server.js || echo "ERROR: server.js not found!"`,
                `ls -d ${outputDir}/.next 2>/dev/null && echo "✓ .next directory copied" || echo "✗ .next directory missing"`,
                `ls -d ${outputDir}/node_modules 2>/dev/null && echo "✓ node_modules copied" || echo "✗ node_modules missing"`,
                `echo "All files in output directory:"`,
                `ls -la ${outputDir} | head -20 || true`,
              ];
            } else {
              return [
                `echo "ERROR: Next.js standalone build not found at ${standalonePath}"`,
                `echo "Make sure you run 'npm run build' in the client directory first"`,
              ];
            }
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            // Verify the standalone files are in place after bundling
            return [
              `echo "Verifying Next.js standalone files after bundling:"`,
              `ls -la ${outputDir}/server.js && echo "✓ server.js found" || echo "✗ server.js missing"`,
              `ls -d ${outputDir}/.next && echo "✓ .next directory found" || echo "✗ .next directory missing"`,
              `ls -d ${outputDir}/node_modules && echo "✓ node_modules found" || echo "✗ node_modules missing"`,
            ];
          },
          beforeInstall(): string[] {
            return [];
          },
        },
      },
      timeout: cdk.Duration.seconds(60),
      memorySize: 2048,
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
    const staticOrigin = new cloudfrontOrigins.S3BucketOrigin(staticAssetsBucket);

    // CloudFront origin for Lambda (SSR + API)
    // Lambda Function URLs format: https://{id}.lambda-url.{region}.on.aws
    // Extract domain name using CDK Fn functions
    // Split URL to extract just the hostname (domain) part
    const lambdaUrlString = lambdaFunctionUrl.url;
    const urlParts = cdk.Fn.split('://', lambdaUrlString);
    const hostAndPath = cdk.Fn.select(1, urlParts);
    const domainNameOnly = cdk.Fn.select(0, cdk.Fn.split('/', hostAndPath));
    
    // Create HttpOrigin with extracted domain
    // The origin ID will be auto-generated from the construct ID, not the domain
    const lambdaOrigin = new cloudfrontOrigins.HttpOrigin(domainNameOnly, {
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
      // Using Certificate with DNS validation (replacement for deprecated DnsValidatedCertificate)
      certificate = new acm.Certificate(this, 'NextJsCertificate', {
        domainName: rootDomainFull,
        subjectAlternativeNames: domainNames.length > 1 ? domainNames.slice(1) : undefined,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
    }

    // CloudFront distribution with proper cache behaviors
    // Create distribution with explicit origin configuration
    const distribution = new cloudfront.Distribution(this, 'NextJsDistribution', {
      defaultBehavior: {
        origin: lambdaOrigin, // SSR handler (all routes except static assets)
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // No cache for SSR
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
      comment: 'Next.js serverless deployment',
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
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
        // Server actions endpoint - no cache
        '/_next/data/*': {
          origin: lambdaOrigin,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
      },
      certificate: certificate,
      domainNames: domainNames.length > 0 ? domainNames : undefined,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultRootObject: 'index.html',
    });

    // Upload static assets from .next/static to S3 with CloudFront cache invalidation
    const staticAssetsPath = join(nextBuildDir, 'static');
    if (existsSync(staticAssetsPath)) {
      new s3deploy.BucketDeployment(this, 'DeployNextJsStaticAssets', {
        sources: [s3deploy.Source.asset(staticAssetsPath)],
        destinationBucket: staticAssetsBucket,
        destinationKeyPrefix: '_next/static',
        prune: true,
        distribution: distribution,
        distributionPaths: ['/*'],
      });
    }

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

    // Print deployment summary
    console.log('\n✅ Next.js deployment configured:');
    console.log(`   CloudFront URL: https://${distribution.distributionDomainName}`);
    if (domainNames.length > 0) {
      console.log(`   Custom Domains: ${domainNames.join(', ')}`);
    }
    console.log(`   Lambda Function: ${nextjsLambda.functionName}`);
    console.log(`   Static Assets: s3://${staticAssetsBucket.bucketName}/_next/static`);
    console.log(`   Lambda Function URL: ${lambdaFunctionUrl.url}`);
  }
}
