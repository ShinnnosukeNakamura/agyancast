#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AgyancastDataStack } from '../lib/agyancast-data-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new AgyancastDataStack(app, 'AgyancastDataStack', { env });
