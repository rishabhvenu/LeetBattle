#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack } from './infrastructure-stack';
import { MonitoringStack } from './monitoring-stack';

const app = new cdk.App();

const env = { 
  account: process.env.CDK_DEFAULT_ACCOUNT, 
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1' 
};

const infra = new InfrastructureStack(app, 'FrontendStack', { 
  env,
  description: 'LeetBattle production infrastructure',
});

// Optional: Deploy monitoring stack if ALARM_EMAIL is set
if (process.env.ALARM_EMAIL) {
  new MonitoringStack(app, 'MonitoringStack', {
    env,
    nextjsLambdaArn: infra.nextjsLambdaArn,
    imageOptLambdaArn: infra.imageOptLambdaArn,
    cloudfrontDistributionId: infra.distributionId,
    alarmEmail: process.env.ALARM_EMAIL,
  });
}

app.synth();

