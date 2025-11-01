#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack } from './infrastructure-stack';

const app = new cdk.App();

new InfrastructureStack(app, 'CodeClashersInfrastructure', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'CodeClashers production infrastructure',
});

app.synth();

