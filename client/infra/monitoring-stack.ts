// CloudWatch Monitoring Stack for LeetBattle
// Provides comprehensive monitoring and alerting for production infrastructure

import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  // Reference to the infrastructure stack outputs
  nextjsLambdaArn?: string;
  imageOptLambdaArn?: string;
  cloudfrontDistributionId?: string;
  // Optional SNS topic for alarms (if not provided, alarms won't send notifications)
  alarmEmail?: string;
}

export class MonitoringStack extends cdk.Stack {
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props?: MonitoringStackProps) {
    super(scope, id, props);

    // Add tags for cost tracking
    cdk.Tags.of(this).add('Project', 'LeetBattle');
    cdk.Tags.of(this).add('Component', 'Monitoring');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');

    // Create SNS topic for alarm notifications
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'LeetBattle-Alarms',
      displayName: 'LeetBattle Monitoring Alarms',
    });

    // Subscribe email if provided
    if (props?.alarmEmail) {
      alarmTopic.addSubscription(
        new subscriptions.EmailSubscription(props.alarmEmail)
      );
    }

    this.alarmTopic = alarmTopic;

    // ===== Lambda Function Alarms =====

    if (props?.nextjsLambdaArn) {
      // Import Lambda function for metrics
      const nextjsLambda = lambda.Function.fromFunctionArn(
        this,
        'NextJsLambda',
        props.nextjsLambdaArn
      );

      // Error alarm - triggers if any errors occur
      const errorAlarm = new cloudwatch.Alarm(this, 'NextJsLambdaErrors', {
        metric: nextjsLambda.metricErrors({
          period: cdk.Duration.minutes(5),
          statistic: cloudwatch.Statistic.SUM,
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmName: 'LeetBattle-NextJsLambda-Errors',
        alarmDescription: 'Alert when Next.js Lambda function has errors',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      errorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

      // Duration alarm - triggers if function takes too long
      const durationAlarm = new cloudwatch.Alarm(this, 'NextJsLambdaDuration', {
        metric: nextjsLambda.metricDuration({
          period: cdk.Duration.minutes(5),
          statistic: cloudwatch.Statistic.AVERAGE,
        }),
        threshold: 45000, // 45 seconds (75% of 60s timeout)
        evaluationPeriods: 2,
        alarmName: 'LeetBattle-NextJsLambda-HighDuration',
        alarmDescription: 'Alert when Next.js Lambda function duration is high',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      durationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

      // Throttle alarm - triggers if function is being throttled
      const throttleAlarm = new cloudwatch.Alarm(this, 'NextJsLambdaThrottles', {
        metric: nextjsLambda.metricThrottles({
          period: cdk.Duration.minutes(5),
          statistic: cloudwatch.Statistic.SUM,
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmName: 'LeetBattle-NextJsLambda-Throttles',
        alarmDescription: 'Alert when Next.js Lambda function is throttled',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      throttleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));
    }

    if (props?.imageOptLambdaArn) {
      // Import image optimization Lambda function
      const imageOptLambda = lambda.Function.fromFunctionArn(
        this,
        'ImageOptLambda',
        props.imageOptLambdaArn
      );

      // Error alarm for image optimization
      const imageOptErrorAlarm = new cloudwatch.Alarm(this, 'ImageOptLambdaErrors', {
        metric: imageOptLambda.metricErrors({
          period: cdk.Duration.minutes(5),
          statistic: cloudwatch.Statistic.SUM,
        }),
        threshold: 1,
        evaluationPeriods: 1,
        alarmName: 'LeetBattle-ImageOptLambda-Errors',
        alarmDescription: 'Alert when image optimization Lambda function has errors',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      imageOptErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));
    }

    // ===== CloudFront Alarms =====

    if (props?.cloudfrontDistributionId) {
      // Create metric filter for CloudFront distribution
      // Note: CloudFront metrics are available via distribution ID without importing the construct

      // 5XX Error Rate alarm - triggers if error rate exceeds 1%
      // Create metric using distribution ID directly
      const errorRateMetric = new cloudwatch.Metric({
        namespace: 'AWS/CloudFront',
        metricName: '5xxErrorRate',
        dimensionsMap: {
          DistributionId: props.cloudfrontDistributionId,
        },
        period: cdk.Duration.minutes(5),
        statistic: cloudwatch.Statistic.AVERAGE,
      });

      const errorRateAlarm = new cloudwatch.Alarm(this, 'CloudFront5xxErrorRate', {
        metric: errorRateMetric,
        threshold: 1, // 1% error rate
        evaluationPeriods: 2,
        alarmName: 'LeetBattle-CloudFront-5xx-ErrorRate',
        alarmDescription: 'Alert when CloudFront 5XX error rate exceeds 1%',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      errorRateAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

      // 4XX Error Rate alarm - triggers if client error rate is high
      const clientErrorMetric = new cloudwatch.Metric({
        namespace: 'AWS/CloudFront',
        metricName: '4xxErrorRate',
        dimensionsMap: {
          DistributionId: props.cloudfrontDistributionId,
        },
        period: cdk.Duration.minutes(5),
        statistic: cloudwatch.Statistic.AVERAGE,
      });

      const clientErrorAlarm = new cloudwatch.Alarm(this, 'CloudFront4xxErrorRate', {
        metric: clientErrorMetric,
        threshold: 5, // 5% client error rate
        evaluationPeriods: 3,
        alarmName: 'LeetBattle-CloudFront-4xx-ErrorRate',
        alarmDescription: 'Alert when CloudFront 4XX error rate exceeds 5%',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      clientErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

      // Cache hit ratio alarm - triggers if cache hit ratio is too low
      const cacheHitMetric = new cloudwatch.Metric({
        namespace: 'AWS/CloudFront',
        metricName: 'CacheHitRate',
        dimensionsMap: {
          DistributionId: props.cloudfrontDistributionId,
        },
        period: cdk.Duration.minutes(15),
        statistic: cloudwatch.Statistic.AVERAGE,
      });

      const cacheHitAlarm = new cloudwatch.Alarm(this, 'CloudFrontCacheHitRatio', {
        metric: cacheHitMetric,
        threshold: 70, // 70% cache hit ratio
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        alarmName: 'LeetBattle-CloudFront-LowCacheHitRatio',
        alarmDescription: 'Alert when CloudFront cache hit ratio falls below 70%',
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      cacheHitAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));
    }

    // ===== Outputs =====

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS topic ARN for CloudWatch alarms',
    });

    new cdk.CfnOutput(this, 'MonitoringStackReady', {
      value: 'true',
      description: 'Monitoring stack deployed successfully',
    });
  }
}

