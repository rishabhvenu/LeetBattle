import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

export class InfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for avatars
    const accountId = props?.env?.account || this.account || 'unknown';
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
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_NONE,
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Get hosted zone for the domain (only if configured)
    const route53HostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
    const hostedZone = route53HostedZoneId
      ? route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
          zoneName: 'leetbattle.net',
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

    const nextLambdaUrl = process.env.NEXTJS_LAMBDA_URL;
    const nextStaticBucketName = process.env.NEXTJS_S3_BUCKET_NAME;

    if (nextLambdaUrl || nextStaticBucketName) {
      let lambdaOrigin: origins.HttpOrigin | undefined;
      if (nextLambdaUrl) {
        const lambdaEndpoint = new URL(nextLambdaUrl);
        lambdaOrigin = new origins.HttpOrigin(lambdaEndpoint.host, {
          originPath: lambdaEndpoint.pathname === '/' ? undefined : lambdaEndpoint.pathname,
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
        });
      }

      let staticOrigin: origins.S3Origin | undefined;
      if (nextStaticBucketName) {
        const nextStaticBucket = s3.Bucket.fromBucketName(this, 'NextJsStaticBucket', nextStaticBucketName);
        staticOrigin = new origins.S3Origin(nextStaticBucket);
      }

      // Ensure at least one origin exists
      if (!lambdaOrigin && !staticOrigin) {
        throw new Error('Either NEXTJS_LAMBDA_URL or NEXTJS_S3_BUCKET_NAME must be provided');
      }

      const certificateArn = process.env.NEXTJS_CERTIFICATE_ARN;
      const certificate = certificateArn
        ? acm.Certificate.fromCertificateArn(this, 'NextJsCertificate', certificateArn)
        : undefined;

      const nextDomainName = process.env.NEXTJS_DOMAIN_NAME;
      const distribution = new cloudfront.Distribution(this, 'NextJsDistribution', {
        defaultBehavior: {
          origin: lambdaOrigin ?? staticOrigin!,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: lambdaOrigin ? cloudfront.CachePolicy.CACHING_DISABLED : cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        additionalBehaviors:
          lambdaOrigin && staticOrigin
            ? {
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
              }
            : undefined,
        certificate,
        domainNames: nextDomainName ? [nextDomainName] : undefined,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      });

      if (nextDomainName && hostedZone) {
        const suffix = `.${hostedZone.zoneName}`;
        const relativeRecordName = nextDomainName.endsWith(suffix)
          ? nextDomainName.slice(0, Math.max(0, nextDomainName.length - suffix.length))
          : nextDomainName;

        new route53.ARecord(this, 'NextJsAliasRecord', {
          zone: hostedZone,
          recordName: relativeRecordName === hostedZone.zoneName ? '' : relativeRecordName,
          target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
          ttl: cdk.Duration.minutes(5),
        });
      }

      new cdk.CfnOutput(this, 'NextJsDistributionId', {
        value: distribution.distributionId,
        description: 'CloudFront distribution serving Next.js',
      });

      new cdk.CfnOutput(this, 'NextJsDistributionUrl', {
        value: `https://${distribution.distributionDomainName}`,
        description: 'CloudFront distribution URL for Next.js',
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
