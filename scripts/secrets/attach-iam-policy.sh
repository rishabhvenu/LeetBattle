#!/bin/bash
# Attach IAM policy to OIDC role for Secrets Manager access
# This script must be run manually with AWS credentials that have IAM permissions

set -e

AWS_REGION="${AWS_REGION:-us-east-1}"
POLICY_NAME="CodeClashersSecretsManagerAccess"
POLICY_FILE="$(dirname "$0")/../backend/k8s/argocd/iam-secrets-policy.json"

echo "🔐 Attaching Secrets Manager IAM policy to OIDC role"
echo ""

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &>/dev/null; then
    echo "❌ Error: AWS CLI not configured or credentials invalid"
    exit 1
fi

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "📋 AWS Account ID: $ACCOUNT_ID"

# Prompt for OIDC role name
echo ""
echo "Enter the OIDC role name (e.g., GitHubActionsRole):"
read -r ROLE_NAME

if [ -z "$ROLE_NAME" ]; then
    echo "❌ Error: Role name is required"
    exit 1
fi

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"

echo ""
echo "Role ARN: $ROLE_ARN"
echo "Policy ARN: $POLICY_ARN"
echo ""

# Check if policy already exists
if aws iam get-policy --policy-arn "$POLICY_ARN" &>/dev/null; then
    echo "⚠️  Policy already exists. Updating..."
    
    # Create new policy version
    aws iam create-policy-version \
        --policy-arn "$POLICY_ARN" \
        --policy-document "file://$POLICY_FILE" \
        --set-as-default
    
    echo "✅ Policy updated"
else
    echo "Creating new policy..."
    
    # Create policy
    aws iam create-policy \
        --policy-name "$POLICY_NAME" \
        --policy-document "file://$POLICY_FILE" \
        --description "Allow GitHub Actions to read secrets from AWS Secrets Manager"
    
    echo "✅ Policy created"
fi

# Attach policy to role
echo ""
echo "Attaching policy to role..."

if aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "$POLICY_ARN" 2>&1 | grep -q "is already attached"; then
    echo "⚠️  Policy already attached to role"
else
    echo "✅ Policy attached to role"
fi

echo ""
echo "✅ IAM configuration complete!"
echo ""
echo "📋 Summary:"
echo "   Policy: $POLICY_ARN"
echo "   Role: $ROLE_ARN"
echo ""
echo "🔍 Verify attachment:"
echo "   aws iam list-attached-role-policies --role-name $ROLE_NAME"
echo ""
echo "📝 Update GitHub Secrets with this ARN if not already set:"
echo "   AWS_ROLE_ARN=$ROLE_ARN"
echo ""

