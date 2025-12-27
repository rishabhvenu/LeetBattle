#!/bin/bash
# Create secrets in AWS Secrets Manager
# This script creates the secret placeholders. Use migrate-to-aws.sh to populate with actual values.

set -e

AWS_REGION="${AWS_REGION:-us-east-1}"

echo "🔐 Creating AWS Secrets Manager secrets in region: $AWS_REGION"
echo ""

# Function to create or update secret
create_or_update_secret() {
    local secret_name="$1"
    local secret_string="$2"
    
    echo "Processing secret: $secret_name"
    
    # Check if secret already exists
    if aws secretsmanager describe-secret --secret-id "$secret_name" --region "$AWS_REGION" >/dev/null 2>&1; then
        echo "  ⚠️  Secret exists. Updating value..."
        aws secretsmanager update-secret \
            --secret-id "$secret_name" \
            --secret-string "$secret_string" \
            --region "$AWS_REGION" >/dev/null
        echo "  ✅ Secret updated"
    else
        echo "  Creating new secret..."
        aws secretsmanager create-secret \
            --name "$secret_name" \
            --description "CodeClashers ${secret_name##*/} secrets" \
            --secret-string "$secret_string" \
            --region "$AWS_REGION" >/dev/null
        echo "  ✅ Secret created"
    fi
    echo ""
}

# Backend secrets structure
# Note: MONGODB_USERNAME and MONGODB_PASSWORD are optional - they will be extracted from MONGODB_URI
# They are included here for backward compatibility but are not required
BACKEND_SECRETS='{
  "REDIS_PASSWORD": "",
  "MONGODB_URI": "",
  "JUDGE0_POSTGRES_USER": "",
  "JUDGE0_POSTGRES_PASSWORD": "",
  "JUDGE0_POSTGRES_DB": "",
  "OPENAI_API_KEY": "",
  "INTERNAL_SERVICE_SECRET": "",
  "BOT_SERVICE_SECRET": "",
  "COLYSEUS_RESERVATION_SECRET": "",
  "AWS_ACCESS_KEY_ID": "",
  "AWS_SECRET_ACCESS_KEY": "",
  "GRAFANA_ADMIN_USER": "",
  "GRAFANA_ADMIN_PASSWORD": ""
}'

# Frontend secrets structure
FRONTEND_SECRETS='{
  "NEXTAUTH_SECRET": "",
  "MONGODB_URI": "",
  "REDIS_PASSWORD": "",
  "OPENAI_API_KEY": "",
  "INTERNAL_SERVICE_SECRET": "",
  "AWS_ROLE_ARN": "",
  "AWS_ACCOUNT_ID": "",
  "ROUTE53_HOSTED_ZONE_ID": ""
}'

# Registry secrets structure
REGISTRY_SECRETS='{
  "GHCR_PAT": ""
}'

echo "=== Creating Backend Secrets ==="
create_or_update_secret "codeclashers/backend" "$BACKEND_SECRETS"

echo "=== Creating Frontend Secrets ==="
create_or_update_secret "codeclashers/frontend" "$FRONTEND_SECRETS"

echo "=== Creating Registry Secrets ==="
create_or_update_secret "codeclashers/ghcr" "$REGISTRY_SECRETS"

echo "✅ All secret structures created successfully!"
echo ""
echo "📝 Next steps:"
echo "   1. Run migrate-to-aws.sh to populate secrets from GitHub Secrets"
echo "   2. Or manually populate using: aws secretsmanager put-secret-value"
echo ""
echo "🔍 View secrets:"
echo "   aws secretsmanager list-secrets --region $AWS_REGION"
echo ""

