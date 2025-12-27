# AWS Secrets Manager Migration Scripts

This directory contains scripts for managing secrets in AWS Secrets Manager for the CodeClashers project.

## Overview

These scripts help you migrate from GitHub Secrets to AWS Secrets Manager, providing centralized secret management with better security and access control.

## Scripts

### 1. `create-secrets-manager.sh`

Creates the secret structure in AWS Secrets Manager.

**Usage:**
```bash
./scripts/secrets/create-secrets-manager.sh
```

**What it does:**
- Creates three secrets in AWS Secrets Manager:
  - `codeclashers/backend` - Backend service secrets
  - `codeclashers/frontend` - Frontend deployment secrets
  - `codeclashers/ghcr` - GitHub Container Registry PAT
- Creates empty JSON structures ready to be populated

**Prerequisites:**
- AWS CLI installed and configured
- AWS credentials with `secretsmanager:CreateSecret` permission

### 2. `migrate-to-aws.sh`

Migrates secret values from GitHub Secrets to AWS Secrets Manager.

**Usage:**
```bash
./scripts/secrets/migrate-to-aws.sh
```

**What it does:**
- Provides two migration options:
  1. Manual migration via AWS Console (recommended)
  2. Interactive script that prompts for each secret value
- Updates the secrets created by `create-secrets-manager.sh`

**Note:** GitHub Secrets API doesn't allow reading secret values for security. You'll need to manually copy values from GitHub → AWS.

**Prerequisites:**
- Secrets created via `create-secrets-manager.sh`
- Access to GitHub Secrets UI
- AWS credentials with `secretsmanager:UpdateSecret` permission

### 3. `attach-iam-policy.sh`

Attaches the Secrets Manager access policy to your OIDC IAM role.

**Usage:**
```bash
./scripts/secrets/attach-iam-policy.sh
```

**What it does:**
- Creates IAM policy: `CodeClashersSecretsManagerAccess`
- Attaches policy to your GitHub Actions OIDC role
- Grants read-only access to `codeclashers/*` secrets

**Prerequisites:**
- IAM role for GitHub Actions OIDC (usually named `GitHubActionsRole`)
- AWS credentials with IAM permissions (`iam:CreatePolicy`, `iam:AttachRolePolicy`)

## Migration Workflow

Follow these steps in order:

### Step 1: Create Secrets Structure

```bash
# Create empty secrets in AWS Secrets Manager
./scripts/secrets/create-secrets-manager.sh
```

### Step 2: Populate Secret Values

**Option A: Manual (Recommended)**
1. Go to [GitHub Secrets](https://github.com/YOUR_REPO/settings/secrets/actions)
2. Open [AWS Secrets Manager Console](https://console.aws.amazon.com/secretsmanager/)
3. For each secret (`codeclashers/backend`, `codeclashers/frontend`, `codeclashers/ghcr`):
   - Click "Retrieve secret value"
   - Edit JSON
   - Copy values from GitHub Secrets

**Option B: Interactive Script**
```bash
# Run interactive migration
./scripts/secrets/migrate-to-aws.sh
```

### Step 3: Configure IAM Permissions

```bash
# Attach IAM policy to OIDC role
./scripts/secrets/attach-iam-policy.sh
```

When prompted, enter your OIDC role name (e.g., `GitHubActionsRole`).

### Step 4: Test Deployment

**Test Backend Deployment:**
```bash
# Go to GitHub Actions
# Run workflow: "Sync Secrets to Kubernetes" (sync-secrets.yml)
```

**Test Frontend Deployment:**
```bash
# Go to GitHub Actions
# Run workflow: "Build Frontend (OpenNext)" (frontend-build.yml)
# Wait for completion
# Run workflow: "Deploy Frontend to AWS (CDK)" (frontend-deploy.yml)
```

### Step 5: Verify

**Verify Kubernetes secrets:**
```bash
kubectl get secrets -n codeclashers
kubectl describe secret app-secrets -n codeclashers
```

**Verify Lambda environment:**
```bash
aws lambda get-function-configuration \
  --function-name FrontendStack-NextJsLambda* \
  --query 'Environment.Variables' \
  --output json
```

### Step 6: Cleanup (Optional)

After successful verification, you can remove old GitHub Secrets:

⚠️ **Keep `AWS_ROLE_ARN`** - This is still needed for OIDC authentication!

Remove these GitHub Secrets (now in Secrets Manager):
- `REDIS_PASSWORD`, `MONGODB_URI` (username/password extracted automatically)
- `JUDGE0_POSTGRES_*`, `OPENAI_API_KEY`, `*_SERVICE_SECRET`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `GRAFANA_*`
- `NEXTAUTH_SECRET`, `AWS_ACCOUNT_ID`, `ROUTE53_HOSTED_ZONE_ID`
- `GHCR_PAT`

**Note:** `MONGODB_USERNAME` and `MONGODB_PASSWORD` are no longer required - they are automatically extracted from `MONGODB_URI` during deployment.

## Secret Organization

### Backend Secrets (`codeclashers/backend`)
```json
{
  "REDIS_PASSWORD": "...",
  "MONGODB_URI": "mongodb://username:password@host:port/db?authSource=admin",
  "JUDGE0_POSTGRES_USER": "...",
  "JUDGE0_POSTGRES_PASSWORD": "...",
  "JUDGE0_POSTGRES_DB": "...",
  "OPENAI_API_KEY": "...",
  "INTERNAL_SERVICE_SECRET": "...",
  "BOT_SERVICE_SECRET": "...",
  "COLYSEUS_RESERVATION_SECRET": "...",
  "AWS_ACCESS_KEY_ID": "...",
  "AWS_SECRET_ACCESS_KEY": "...",
  "GRAFANA_ADMIN_USER": "...",
  "GRAFANA_ADMIN_PASSWORD": "..."
}
```

**Note:** Only `MONGODB_URI` is required. Username and password are automatically extracted from the URI during deployment. The URI format should be: `mongodb://username:password@host:port/db?authSource=admin`

### Frontend Secrets (`codeclashers/frontend`)
```json
{
  "NEXTAUTH_SECRET": "...",
  "MONGODB_URI": "...",
  "REDIS_PASSWORD": "...",
  "OPENAI_API_KEY": "...",
  "INTERNAL_SERVICE_SECRET": "...",
  "AWS_ROLE_ARN": "...",
  "AWS_ACCOUNT_ID": "...",
  "ROUTE53_HOSTED_ZONE_ID": "..."
}
```

### Registry Secrets (`codeclashers/ghcr`)
```json
{
  "GHCR_PAT": "..."
}
```

## Updating Secrets

### Via AWS CLI
```bash
# Update entire secret
aws secretsmanager update-secret \
  --secret-id codeclashers/backend \
  --secret-string '{"KEY":"new-value",...}'

# Update single key (requires jq)
current=$(aws secretsmanager get-secret-value --secret-id codeclashers/backend --query SecretString --output text)
updated=$(echo "$current" | jq '.REDIS_PASSWORD = "new-password"')
aws secretsmanager update-secret \
  --secret-id codeclashers/backend \
  --secret-string "$updated"
```

### Via AWS Console
1. Go to [AWS Secrets Manager](https://console.aws.amazon.com/secretsmanager/)
2. Click on secret name (e.g., `codeclashers/backend`)
3. Click "Retrieve secret value"
4. Click "Edit"
5. Modify JSON values
6. Click "Save"

### Re-deploy After Update
After updating secrets, re-run the deployment workflows to apply changes:
- For K8s: Run `sync-secrets.yml` workflow
- For Lambda: Run `frontend-deploy.yml` workflow

## Troubleshooting

### Error: "User is not authorized to perform: secretsmanager:GetSecretValue"

**Problem:** IAM policy not attached to OIDC role.

**Solution:**
```bash
./scripts/secrets/attach-iam-policy.sh
```

### Error: "Secret not found: codeclashers/backend"

**Problem:** Secrets not created in AWS Secrets Manager.

**Solution:**
```bash
./scripts/secrets/create-secrets-manager.sh
```

### Error: "ResourceNotFoundException: Secrets Manager can't find the specified secret"

**Problem:** Secret exists but in wrong AWS region.

**Solution:** Check AWS_REGION environment variable (should be `us-east-1`):
```bash
export AWS_REGION=us-east-1
./scripts/secrets/create-secrets-manager.sh
```

### Workflow fails with "No credentials"

**Problem:** `AWS_ROLE_ARN` GitHub Secret not set or invalid.

**Solution:**
1. Verify IAM role exists: `aws iam get-role --role-name GitHubActionsRole`
2. Update GitHub Secret: Settings → Secrets → `AWS_ROLE_ARN`

## Security Best Practices

✅ **Do:**
- Use AWS Secrets Manager for all sensitive data
- Rotate secrets regularly (especially DB passwords, API keys)
- Use least-privilege IAM policies
- Keep `AWS_ROLE_ARN` in GitHub Secrets (required for OIDC)

❌ **Don't:**
- Commit secrets to Git (use `.gitignore`)
- Share secrets via insecure channels (Slack, email)
- Grant broad IAM permissions (`secretsmanager:*`)
- Use long-lived AWS access keys (use OIDC instead)

## Related Documentation

- [IAM Policy Setup](../../backend/k8s/argocd/README-IAM-POLICY.md)
- [Environment Variables Reference](../../context/backend/environment-variables.md)
- [AWS Secrets Manager Docs](https://docs.aws.amazon.com/secretsmanager/)
- [GitHub OIDC Docs](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review GitHub Actions workflow logs
3. Verify AWS IAM permissions
4. Check AWS Secrets Manager console

For questions, contact the infrastructure team.

