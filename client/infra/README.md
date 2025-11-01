# CodeClashers CDK Infrastructure

This CDK stack deploys the Next.js application as a fully serverless application on AWS.

## Architecture

- **Lambda Function**: Handles SSR (Server-Side Rendering) and API routes
- **S3 Bucket**: Stores static assets (`_next/static/*`)
- **CloudFront**: CDN that routes requests:
  - `/_next/static/*` → S3 (cached)
  - `/static/*` → S3 (cached)
  - `/api/*` → Lambda (no cache)
  - `/*` → Lambda SSR (no cache)

## Deployment Steps

### Prerequisites

1. Build Next.js in standalone mode:
   ```bash
   cd ../  # Go to client directory
   npm run build
   ```

2. Set required environment variables in your GitHub Actions secrets or locally:
   - `MONGODB_URI`
   - `NEXTAUTH_SECRET`
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `S3_BUCKET_NAME` (optional, defaults to auto-generated)
   - `ROUTE53_HOSTED_ZONE_ID` (required for automatic certificate creation and domain setup)
   - `ROUTE53_HOSTED_ZONE_NAME` (optional, defaults to 'leetbattle.net' if not specified)
   - `NEXTJS_DOMAIN_NAME` (optional, defaults to the hosted zone name if not specified)
   
   Note: The certificate is automatically created and validated via DNS in us-east-1 (required by CloudFront).
   No manual certificate ARN input is needed.

### Deploy

```bash
npm install
npm run deploy
```

### CI/CD Deployment

The GitHub Actions workflow (`.github/workflows/deploy-frontend.yml`) will:
1. Build Next.js in standalone mode
2. Deploy the CDK stack
3. Upload static assets to S3
4. Create Lambda function with Next.js server
5. Configure CloudFront distribution

## How It Works

1. **Next.js Build**: When you run `next build` with `output: 'standalone'`, Next.js creates a `.next/standalone` directory with a minimal server.

2. **Lambda Handler**: The `lambda-handler.ts` file wraps the Next.js standalone server to work with Lambda Function URLs by:
   - Converting API Gateway events to Next.js Request objects
   - Calling the Next.js server handler
   - Converting Next.js Response objects back to API Gateway format

3. **CDK Bundling**: The `NodejsFunction` construct bundles the handler and copies the standalone build into the Lambda package.

4. **Static Assets**: The `.next/static` directory is uploaded to S3 using `BucketDeployment`, and CloudFront serves them with aggressive caching.

5. **Routing**: CloudFront behaviors route different paths:
   - Static assets → S3
   - API routes and SSR → Lambda

## Environment Variables

All environment variables are passed to the Lambda function. Make sure to set them in your deployment environment (GitHub Secrets for CI/CD, or `.env` for local deployment).

## Outputs

After deployment, CDK outputs:
- `NextJsDistributionUrl`: CloudFront URL for your app
- `NextJsLambdaFunctionArn`: Lambda function ARN
- `NextJsStaticBucketName`: S3 bucket for static assets
- `AvatarBucketName`: S3 bucket for user avatars

## Notes

- The Lambda function timeout is set to 30 seconds (adjust if needed for long-running operations)
- Memory is set to 1024 MB (adjust based on your needs)
- Static assets are cached aggressively by CloudFront
- SSR and API routes are never cached

