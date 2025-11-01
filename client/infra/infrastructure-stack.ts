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
    const avatarBucket = new s3.Bucket(this, 'AvatarsBucket', {
      bucketName: process.env.S3_BUCKET_NAME || `codeclashers-avatars-${this.account}`,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE],
          allowedOrigins: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 86400,
        },
      ],
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Get hosted zone for the domain
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      zoneName: 'leetbattle.net',
      hostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID || '',
    });

    // Create A record for Colyseus if configured
    if (process.env.COLYSEUS_DOMAIN && process.env.COLYSEUS_HOST_IP) {
      new route53.ARecord(this, 'ColyseusARecord', {
        zone: hostedZone,
        recordName: `${process.env.COLYSEUS_DOMAIN}.leetbattle.net`,
        target: route53.RecordTarget.fromIpAddresses(process.env.COLYSEUS_HOST_IP),
        ttl: cdk.Duration.minutes(5),
      });
    }

    // TODO: Add CloudFront distribution and Lambda for Next.js once you specify the Lambda function URL or S3 bucket
    
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

