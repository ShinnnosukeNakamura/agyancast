import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { execSync } from 'child_process';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

export class AgyancastDataStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const prefix = this.node.tryGetContext('prefix') ?? 'agyancast';
    const envName = this.node.tryGetContext('env') ?? 'dev';
    const dataBucketName =
      this.node.tryGetContext('dataBucketName') ?? `${prefix}-${envName}-data`;
    const webBucketName =
      this.node.tryGetContext('webBucketName') ?? `${prefix}-${envName}-web`;

    const dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: dataBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      autoDeleteObjects: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const cfnBucket = dataBucket.node.defaultChild as s3.CfnBucket;
    cfnBucket.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;
    cfnBucket.cfnOptions.updateReplacePolicy = cdk.CfnDeletionPolicy.RETAIN;

    const webBucket = new s3.Bucket(this, 'WebBucket', {
      bucketName: webBucketName,
      publicReadAccess: true,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
      encryption: s3.BucketEncryption.S3_MANAGED,
      autoDeleteObjects: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const cfnWebBucket = webBucket.node.defaultChild as s3.CfnBucket;
    cfnWebBucket.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;
    cfnWebBucket.cfnOptions.updateReplacePolicy = cdk.CfnDeletionPolicy.RETAIN;

    const spotsCsvPath = path.join(__dirname, '..', '..', 'spots.csv');
    const spotsCsvBody = fs.readFileSync(spotsCsvPath, 'utf8');

    new s3deploy.BucketDeployment(this, 'DeploySpotsCsv', {
      sources: [s3deploy.Source.data('spots.csv', spotsCsvBody)],
      destinationBucket: dataBucket,
      destinationKeyPrefix: 'master',
      prune: false,
    });

    new s3deploy.BucketDeployment(this, 'DeployWebAssets', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'web'))],
      destinationBucket: webBucket,
      prune: false,
    });

    const ingestFn = new NodejsFunction(this, 'IngestGtfsRtFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '..', 'lambda', 'ingest.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        DATA_BUCKET: dataBucket.bucketName,
        RAW_PREFIX: 'raw/',
        MASTER_SPOTS_KEY: 'master/spots.csv',
        TIMEZONE: 'Asia/Tokyo',
        ENV: envName,
      },
    });

    dataBucket.grantReadWrite(ingestFn);

    new events.Rule(this, 'IngestScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(10)),
      targets: [new targets.LambdaFunction(ingestFn)],
    });

    const transformFn = new NodejsFunction(this, 'TransformBronzeSilverFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: path.join(__dirname, '..', 'lambda', 'transform.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
      environment: {
        DATA_BUCKET: dataBucket.bucketName,
        RAW_PREFIX: 'raw/',
        BRONZE_PREFIX: 'bronze/',
        SILVER_PREFIX: 'silver/',
        MASTER_SPOTS_KEY: 'master/spots.csv',
        FILL_MAX_AGE_MINUTES: '180',
        TIMEZONE: 'Asia/Tokyo',
        WEB_BUCKET: webBucket.bucketName,
        ENV: envName,
      },
    });

    dataBucket.grantReadWrite(transformFn);
    webBucket.grantReadWrite(transformFn);

    new events.Rule(this, 'TransformScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(10)),
      targets: [new targets.LambdaFunction(transformFn)],
    });

    const dailyDelayPath = path.join(__dirname, '..', 'lambda_py', 'daily_delay_mart');
    const dailyDelayFn = new lambda.Function(this, 'DailyDelayMartFunction', {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(dailyDelayPath, {
        bundling: {
          image: lambda.Runtime.PYTHON_3_11.bundlingImage,
          local: {
            tryBundle(outputDir: string) {
              execSync(
                [
                  'python3 -m pip install',
                  '--platform manylinux2014_x86_64',
                  '--implementation cp',
                  '--python-version 311',
                  '--abi cp311',
                  '--only-binary=:all:',
                  `-r ${path.join(dailyDelayPath, 'requirements.txt')}`,
                  `-t ${outputDir}`,
                ].join(' '),
                { stdio: 'inherit' }
              );
              fs.copyFileSync(
                path.join(dailyDelayPath, 'handler.py'),
                path.join(outputDir, 'handler.py')
              );
              return true;
            },
          },
          command: [
            'bash',
            '-c',
            [
              'pip install',
              '--platform manylinux2014_x86_64',
              '--implementation cp',
              '--python-version 311',
              '--abi cp311',
              '--only-binary=:all:',
              '-r /asset-input/requirements.txt',
              '-t /asset-output',
              '&& cp /asset-input/handler.py /asset-output/handler.py',
            ].join(' '),
          ],
        },
      }),
      timeout: cdk.Duration.minutes(10),
      memorySize: 1024,
      environment: {
        DATA_BUCKET: dataBucket.bucketName,
        BRONZE_PREFIX: 'bronze/',
        SILVER_PREFIX: 'silver/',
        MASTER_SPOTS_KEY: 'master/spots.csv',
        WEB_BUCKET: webBucket.bucketName,
        TIMEZONE: 'Asia/Tokyo',
        ENV: envName,
      },
    });

    dataBucket.grantReadWrite(dailyDelayFn);
    webBucket.grantReadWrite(dailyDelayFn);

    new events.Rule(this, 'DailyDelayMartScheduleRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(10)),
      targets: [new targets.LambdaFunction(dailyDelayFn)],
    });

    new cdk.CfnOutput(this, 'DataBucketName', {
      value: dataBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'DataBucketUrl', {
      value: `s3://${dataBucket.bucketName}`,
    });

    new cdk.CfnOutput(this, 'WebBucketName', {
      value: webBucket.bucketName,
    });

    new cdk.CfnOutput(this, 'WebSiteUrl', {
      value: webBucket.bucketWebsiteUrl,
    });
  }
}
