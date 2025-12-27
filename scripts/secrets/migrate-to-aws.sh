#!/bin/bash
# Migrate secrets from GitHub Secrets to AWS Secrets Manager
# This is a one-time migration script

set -e

AWS_REGION="${AWS_REGION:-us-east-1}"

echo "🔄 Migrating secrets from GitHub to AWS Secrets Manager"
echo ""
echo "⚠️  IMPORTANT: This script requires GitHub CLI (gh) to be installed and authenticated"
echo "   Install: https://cli.github.com/"
echo "   Authenticate: gh auth login"
echo ""

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
    echo "❌ Error: GitHub CLI (gh) is not installed"
    echo "   Install from: https://cli.github.com/"
    exit 1
fi

# Check if jq is available
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is not installed"
    echo "   Install: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 1
fi

# Prompt for confirmation
read -p "⚠️  This will read secrets from GitHub and write to AWS Secrets Manager. Continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "📖 Reading secrets from GitHub repository..."

# Function to get GitHub secret value (secrets are masked, so we can't actually read them via API)
# This function is a placeholder - user needs to manually provide values
get_github_secret() {
    local secret_name="$1"
    echo "  ⚠️  Note: GitHub Secrets API doesn't allow reading secret values (security feature)"
    echo "  You must manually provide the value for: $secret_name"
    read -sp "  Enter value for $secret_name: " secret_value
    echo ""
    echo "$secret_value"
}

echo ""
echo "⚠️  MANUAL MIGRATION REQUIRED"
echo ""
echo "GitHub Secrets API does not allow reading secret values for security reasons."
echo "You have two options:"
echo ""
echo "Option 1: Manual migration via AWS Console"
echo "  1. Go to AWS Secrets Manager Console"
echo "  2. Find secrets: codeclashers/backend, codeclashers/frontend, codeclashers/ghcr"
echo "  3. Copy values from GitHub Secrets (Settings > Secrets and variables > Actions)"
echo ""
echo "Option 2: Use this interactive script"
echo ""

read -p "Use interactive script? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "✅ Please manually migrate secrets via AWS Console"
    echo "   AWS Secrets Manager: https://console.aws.amazon.com/secretsmanager/"
    echo "   GitHub Secrets: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/settings/secrets/actions"
    exit 0
fi

echo ""
echo "=== Interactive Migration ==="
echo ""

# Function to extract MongoDB credentials from URI
extract_mongodb_credentials() {
    local uri="${1:-}"
    
    if [ -z "$uri" ]; then
        return 1
    fi
    
    # Extract username and password from URI
    if echo "$uri" | grep -qE '^mongodb(\+srv)?://[^@]+@'; then
        MONGODB_USERNAME=$(echo "$uri" | sed -n 's|^mongodb\(+srv\)\?://\([^:]*\):\([^@]*\)@.*|\2|p')
        MONGODB_PASSWORD=$(echo "$uri" | sed -n 's|^mongodb\(+srv\)\?://\([^:]*\):\([^@]*\)@.*|\3|p')
        
        # URL decode password in case it contains special characters
        if [ -n "$MONGODB_PASSWORD" ]; then
            MONGODB_PASSWORD=$(printf '%b\n' "${MONGODB_PASSWORD//%/\\x}")
        fi
    fi
    
    # Set defaults if extraction failed
    MONGODB_USERNAME="${MONGODB_USERNAME:-admin}"
    MONGODB_PASSWORD="${MONGODB_PASSWORD:-}"
}

# Backend secrets
echo "Backend secrets (codeclashers/backend):"
REDIS_PASSWORD=$(get_github_secret "REDIS_PASSWORD")
MONGODB_URI=$(get_github_secret "MONGODB_URI")

# Extract MongoDB credentials from URI (username/password are optional in GitHub Secrets)
# If they exist in GitHub Secrets, use them; otherwise extract from URI
echo "  Note: MONGODB_USERNAME and MONGODB_PASSWORD are optional - they will be extracted from MONGODB_URI"
echo "  You can skip these prompts by pressing Enter"
MONGODB_USERNAME_INPUT=$(get_github_secret "MONGODB_USERNAME" "true")
MONGODB_PASSWORD_INPUT=$(get_github_secret "MONGODB_PASSWORD" "true")

# Extract from URI if not provided separately
if [ -z "$MONGODB_USERNAME_INPUT" ] && [ -n "$MONGODB_URI" ]; then
    echo "  Extracting MongoDB credentials from MONGODB_URI..."
    extract_mongodb_credentials "$MONGODB_URI"
    MONGODB_USERNAME="${MONGODB_USERNAME:-admin}"
    MONGODB_PASSWORD="${MONGODB_PASSWORD:-}"
else
    MONGODB_USERNAME="${MONGODB_USERNAME_INPUT:-admin}"
    MONGODB_PASSWORD="${MONGODB_PASSWORD_INPUT:-}"
fi

JUDGE0_POSTGRES_USER=$(get_github_secret "JUDGE0_POSTGRES_USER")
JUDGE0_POSTGRES_PASSWORD=$(get_github_secret "JUDGE0_POSTGRES_PASSWORD")
JUDGE0_POSTGRES_DB=$(get_github_secret "JUDGE0_POSTGRES_DB")
OPENAI_API_KEY=$(get_github_secret "OPENAI_API_KEY")
INTERNAL_SERVICE_SECRET=$(get_github_secret "INTERNAL_SERVICE_SECRET")
BOT_SERVICE_SECRET=$(get_github_secret "BOT_SERVICE_SECRET")
COLYSEUS_RESERVATION_SECRET=$(get_github_secret "COLYSEUS_RESERVATION_SECRET")
AWS_ACCESS_KEY_ID=$(get_github_secret "AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY=$(get_github_secret "AWS_SECRET_ACCESS_KEY")
GRAFANA_ADMIN_USER=$(get_github_secret "GRAFANA_ADMIN_USER")
GRAFANA_ADMIN_PASSWORD=$(get_github_secret "GRAFANA_ADMIN_PASSWORD")

BACKEND_JSON=$(jq -n \
  --arg redis_pw "$REDIS_PASSWORD" \
  --arg mongo_uri "$MONGODB_URI" \
  --arg judge0_user "$JUDGE0_POSTGRES_USER" \
  --arg judge0_pw "$JUDGE0_POSTGRES_PASSWORD" \
  --arg judge0_db "$JUDGE0_POSTGRES_DB" \
  --arg openai "$OPENAI_API_KEY" \
  --arg internal "$INTERNAL_SERVICE_SECRET" \
  --arg bot "$BOT_SERVICE_SECRET" \
  --arg colyseus "$COLYSEUS_RESERVATION_SECRET" \
  --arg aws_key "$AWS_ACCESS_KEY_ID" \
  --arg aws_secret "$AWS_SECRET_ACCESS_KEY" \
  --arg grafana_user "$GRAFANA_ADMIN_USER" \
  --arg grafana_pw "$GRAFANA_ADMIN_PASSWORD" \
  '{
    "REDIS_PASSWORD": $redis_pw,
    "MONGODB_URI": $mongo_uri,
    "JUDGE0_POSTGRES_USER": $judge0_user,
    "JUDGE0_POSTGRES_PASSWORD": $judge0_pw,
    "JUDGE0_POSTGRES_DB": $judge0_db,
    "OPENAI_API_KEY": $openai,
    "INTERNAL_SERVICE_SECRET": $internal,
    "BOT_SERVICE_SECRET": $bot,
    "COLYSEUS_RESERVATION_SECRET": $colyseus,
    "AWS_ACCESS_KEY_ID": $aws_key,
    "AWS_SECRET_ACCESS_KEY": $aws_secret,
    "GRAFANA_ADMIN_USER": $grafana_user,
    "GRAFANA_ADMIN_PASSWORD": $grafana_pw
  }')

echo ""
echo "Writing backend secrets to AWS Secrets Manager..."
aws secretsmanager update-secret \
    --secret-id "codeclashers/backend" \
    --secret-string "$BACKEND_JSON" \
    --region "$AWS_REGION" >/dev/null
echo "✅ Backend secrets updated"

# Frontend secrets
echo ""
echo "Frontend secrets (codeclashers/frontend):"
NEXTAUTH_SECRET=$(get_github_secret "NEXTAUTH_SECRET")
AWS_ROLE_ARN=$(get_github_secret "AWS_ROLE_ARN")
AWS_ACCOUNT_ID=$(get_github_secret "AWS_ACCOUNT_ID")
ROUTE53_HOSTED_ZONE_ID=$(get_github_secret "ROUTE53_HOSTED_ZONE_ID")

FRONTEND_JSON=$(jq -n \
  --arg nextauth "$NEXTAUTH_SECRET" \
  --arg mongo_uri "$MONGODB_URI" \
  --arg redis_pw "$REDIS_PASSWORD" \
  --arg openai "$OPENAI_API_KEY" \
  --arg internal "$INTERNAL_SERVICE_SECRET" \
  --arg role_arn "$AWS_ROLE_ARN" \
  --arg account_id "$AWS_ACCOUNT_ID" \
  --arg zone_id "$ROUTE53_HOSTED_ZONE_ID" \
  '{
    "NEXTAUTH_SECRET": $nextauth,
    "MONGODB_URI": $mongo_uri,
    "REDIS_PASSWORD": $redis_pw,
    "OPENAI_API_KEY": $openai,
    "INTERNAL_SERVICE_SECRET": $internal,
    "AWS_ROLE_ARN": $role_arn,
    "AWS_ACCOUNT_ID": $account_id,
    "ROUTE53_HOSTED_ZONE_ID": $zone_id
  }')

echo ""
echo "Writing frontend secrets to AWS Secrets Manager..."
aws secretsmanager update-secret \
    --secret-id "codeclashers/frontend" \
    --secret-string "$FRONTEND_JSON" \
    --region "$AWS_REGION" >/dev/null
echo "✅ Frontend secrets updated"

# Registry secrets
echo ""
echo "Registry secrets (codeclashers/ghcr):"
GHCR_PAT=$(get_github_secret "GHCR_PAT")

REGISTRY_JSON=$(jq -n \
  --arg ghcr_pat "$GHCR_PAT" \
  '{
    "GHCR_PAT": $ghcr_pat
  }')

echo ""
echo "Writing registry secrets to AWS Secrets Manager..."
aws secretsmanager update-secret \
    --secret-id "codeclashers/ghcr" \
    --secret-string "$REGISTRY_JSON" \
    --region "$AWS_REGION" >/dev/null
echo "✅ Registry secrets updated"

echo ""
echo "✅ Migration complete!"
echo ""
echo "🔍 Verify secrets:"
echo "   aws secretsmanager get-secret-value --secret-id codeclashers/backend --region $AWS_REGION"
echo "   aws secretsmanager get-secret-value --secret-id codeclashers/frontend --region $AWS_REGION"
echo "   aws secretsmanager get-secret-value --secret-id codeclashers/ghcr --region $AWS_REGION"
echo ""

