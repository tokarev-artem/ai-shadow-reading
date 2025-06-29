import { Construct } from 'constructs';
import { Stack, Duration, CfnOutput, RemovalPolicy, StackProps } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { HttpApi, HttpMethod, CfnStage, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Bucket, BlockPublicAccess, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Distribution, ViewerProtocolPolicy, AllowedMethods, CachedMethods } from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export class AiShadowReadingStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // S3 bucket for recordings
    const recordingsBucket = new Bucket(this, 'RecordingsBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        { expiration: Duration.days(30) },
        { abortIncompleteMultipartUploadAfter: Duration.days(7) },
      ],
    });

    // Transcribe service role
    const transcribeRole = new Role(this, 'TranscribeServiceRole', {
      assumedBy: new ServicePrincipal('transcribe.amazonaws.com'),
      description: 'Role for AWS Transcribe to access S3',
    });

    transcribeRole.addToPolicy(new PolicyStatement({
      actions: ['s3:PutObject', 's3:PutObjectAcl'],
      resources: [recordingsBucket.arnForObjects('transcriptions/*')],
    }));

    // Shadow Reading Lambda
    const shadowReadingLambda = new NodejsFunction(this, 'ShadowReadingHandler', {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/shadow-reading/index.js'),
      handler: 'handler',
      environment: {
        RECORDINGS_BUCKET: recordingsBucket.bucketName,
        TRANSCRIBE_REGION: this.region,
        TRANSCRIBE_ROLE_ARN: transcribeRole.roleArn,
      },
      timeout: Duration.seconds(30),
    });

    // Grant Polly permissions
    shadowReadingLambda.addToRolePolicy(new PolicyStatement({
      actions: ['polly:SynthesizeSpeech'],
      resources: ['*'],
    }));

    // Analysis Lambda
    const analysisFunction = new NodejsFunction(this, 'AnalysisFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/analysis/index.js'),
      handler: 'handler',
      environment: {
        RECORDINGS_BUCKET: recordingsBucket.bucketName,
        TRANSCRIBE_REGION: this.region,
        TRANSCRIBE_ROLE_ARN: transcribeRole.roleArn,
        DEBUG: 'true',
      },
      timeout: Duration.seconds(120),
      bundling: {
        nodeModules: ['@smithy/node-http-handler'],
        forceDockerBundling: false,
      },
    });

    // Grant Transcribe permissions
    analysisFunction.addToRolePolicy(new PolicyStatement({
      actions: ['transcribe:StartTranscriptionJob', 'transcribe:GetTranscriptionJob'],
      resources: [`arn:aws:transcribe:${this.region}:${this.account}:transcription-job/*`],
    }));

    // Grant bucket access
    recordingsBucket.grantReadWrite(analysisFunction);
    recordingsBucket.addToResourcePolicy(new PolicyStatement({
      actions: ['s3:PutObject', 's3:PutObjectAcl'],
      resources: [recordingsBucket.arnForObjects('transcriptions/*')],
      principals: [new ServicePrincipal('transcribe.amazonaws.com')],
    }));

    // Generate Text Lambda
    const generateTextFunction = new NodejsFunction(this, 'GenerateTextFunction', {
      runtime: Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/generate-text/index.js'),
      handler: 'handler',
      environment: {
        BEDROCK_REGION: this.region,
      },
      timeout: Duration.seconds(30),
      bundling: {
        nodeModules: ['@aws-sdk/client-bedrock-runtime'],
        forceDockerBundling: false,
      },
    });

    // Grant Bedrock permissions for Titan Text Express
    generateTextFunction.addToRolePolicy(new PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-text-express-v1'],
    }));

    // HTTP API Gateway
    const httpApi = new HttpApi(this, 'ShadowReadingHttpApi', {
      apiName: 'Shadow Reading Service',
      corsPreflight: {
        allowHeaders: ['Content-Type', 'Authorization'],
        allowMethods: [CorsHttpMethod.POST],
        allowOrigins: ['*'],
      },
    });

    // API Gateway Stage with Access Logging
    const logGroup = new LogGroup(this, 'ApiAccessLog');
    new CfnStage(this, 'ApiStage', {
      apiId: httpApi.httpApiId,
      stageName: 'prod',
      autoDeploy: true,
      accessLogSettings: {
        destinationArn: logGroup.logGroupArn,
        format: JSON.stringify({
          requestId: '$context.requestId',
          ip: '$context.identity.sourceIp',
          requestTime: '$context.requestTime',
          httpMethod: '$context.httpMethod',
          path: '$context.path',
          status: '$context.status',
          protocol: '$context.protocol',
        }),
      },
    });

    // Routes
    httpApi.addRoutes({
      path: '/',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ShadowReadingIntegration', shadowReadingLambda),
    });

    httpApi.addRoutes({
      path: '/analyze',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('AnalysisIntegration', analysisFunction),
    });

    httpApi.addRoutes({
      path: '/recordings',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('RecordingsIntegration', shadowReadingLambda),
    });

    httpApi.addRoutes({
      path: '/generate-text',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('GenerateTextIntegration', generateTextFunction),
    });

    // Frontend S3 bucket
    const frontendBucket = new Bucket(this, 'FrontendBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
    });

    // CloudFront Distribution
    const distribution = new Distribution(this, 'FrontendDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: new S3Origin(frontendBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: CachedMethods.CACHE_GET_HEAD,
        compress: true,
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // Bucket policy for CloudFront
    frontendBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [frontendBucket.arnForObjects('*')],
        principals: [new ServicePrincipal('cloudfront.amazonaws.com')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      }),
    );

    // Deploy frontend assets
    new BucketDeployment(this, 'DeployFrontend', {
      sources: [Source.asset(path.join(__dirname, '../frontend'))],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 1024,
    });

    // Outputs
    new CfnOutput(this, 'ApiUrl', {
      value: httpApi.url || '',
      description: 'API Gateway URL',
    });

    new CfnOutput(this, 'FrontendUrl', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront Distribution URL',
    });
  }
}