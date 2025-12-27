# IAM Policy Setup for AWS Secrets Manager

This directory contains IAM policy documents for GitHub Actions OIDC authentication.

## Secrets Manager Access Policy

**File:** `iam-secrets-policy.json`

This policy grants GitHub Actions workflows permission to read secrets from AWS Secrets Manager.

### Permissions Granted

- `secretsmanager:GetSecretValue` - Read secret values
- `secretsmanager:DescribeSecret` - Get secret metadata
- `secretsmanager:ListSecrets` - List available secrets

### Resource Scope

The policy is scoped to secrets with the prefix: `codeclashers/*`

This includes:
- `codeclashers/backend` - Backend service secrets
- `codeclashers/frontend` - Frontend deployment secrets
- `codeclashers/ghcr` - GitHub Container Registry secrets

## Attaching the Policy

### Option 1: Automated Script

Run the provided script:

```bash
./scripts/secrets/attach-iam-policy.sh
```

The script will:
1. Create or update the IAM policy
2. Attach it to your OIDC role
3. Verify the configuration

### Option 2: Manual via AWS Console

1. Go to AWS IAM Console → Policies
2. Create policy → JSON
3. Paste contents of `iam-secrets-policy.json`
4. Name: `CodeClashersSecretsManagerAccess`
5. Create policy
6. Go to Roles → Find your OIDC role (e.g., `GitHubActionsRole`)
7. Attach policies → Select `CodeClashersSecretsManagerAccess`
8. Attach policy

### Option 3: AWS CLI

```bash
# Create policy
aws iam create-policy \
  --policy-name CodeClashersSecretsManagerAccess \
  --policy-document file://backend/k8s/argocd/iam-secrets-policy.json

# Attach to role (replace YOUR_ROLE_NAME)
aws iam attach-role-policy \
  --role-name YOUR_ROLE_NAME \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/CodeClashersSecretsManagerAccess
```

## Verification

Verify the policy is attached:

```bash
aws iam list-attached-role-policies --role-name YOUR_ROLE_NAME
```

Test secret access:

```bash
aws secretsmanager get-secret-value --secret-id codeclashers/backend
```

## Security Notes

- The policy uses **least privilege** - only read access to specific secrets
- Secrets are masked in GitHub Actions logs via `::add-mask::`
- OIDC authentication prevents long-lived credentials
- Policy scope is limited to `codeclashers/*` prefix

## Troubleshooting

### "User is not authorized to perform: secretsmanager:GetSecretValue"

The policy is not attached or the role ARN in GitHub Secrets is incorrect.

**Solution:**
1. Run `attach-iam-policy.sh` to attach the policy
2. Verify `AWS_ROLE_ARN` in GitHub Secrets matches your OIDC role

### "Secret not found"

The secret doesn't exist in Secrets Manager.

**Solution:**
1. Run `scripts/secrets/create-secrets-manager.sh` to create secret structures
2. Run `scripts/secrets/migrate-to-aws.sh` to populate with values

## Related Documentation

- [AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [Migration Plan](../../context/backend/environment-variables.md)

