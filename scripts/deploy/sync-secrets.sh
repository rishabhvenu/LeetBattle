#!/bin/bash
# Sync secrets to Kubernetes
# Uses .env.dev locally or GitHub Secrets in production

set -e

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

echo "🔐 Syncing secrets to Kubernetes namespace: $NAMESPACE"

# Ensure namespace exists
echo "   Creating namespace if not exists..."
$KUBECTL create namespace "$NAMESPACE" --dry-run=client -o yaml | $KUBECTL apply -f -

# Check if envsubst is available
if ! command -v envsubst &> /dev/null; then
    echo "   Installing envsubst..."
    if [ "$PLATFORM" = "darwin" ]; then
        brew install gettext
        export PATH="/usr/local/opt/gettext/bin:$PATH"
    else
        sudo apt-get update && sudo apt-get install -y gettext-base
    fi
fi

# Extract MongoDB username and password from URI if not provided separately
if [ -z "$MONGODB_USERNAME" ] && [ -n "$MONGODB_URI" ]; then
    export MONGODB_USERNAME=$(echo "$MONGODB_URI" | sed -n 's|mongodb://\([^:]*\):\([^@]*\)@.*|\1|p' || echo "admin")
    MONGO_PASS=$(echo "$MONGODB_URI" | sed -n 's|mongodb://\([^:]*\):\([^@]*\)@.*|\2|p' || echo "")
    if [ -n "$MONGO_PASS" ]; then
        export MONGODB_PASSWORD="$MONGO_PASS"
    fi
fi

# Default MongoDB username if still not set
export MONGODB_USERNAME="${MONGODB_USERNAME:-admin}"

# Generate MongoDB keyfile if not provided
if [ -z "$MONGODB_KEYFILE" ]; then
    export MONGODB_KEYFILE=$(openssl rand -base64 756)
fi

# Set default values for ports
export REDIS_HOST="${REDIS_HOST:-redis-cluster}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export JUDGE0_PORT="${JUDGE0_PORT:-2358}"
export MONGODB_PORT="${MONGODB_PORT:-27017}"
export COLYSEUS_PORT="${COLYSEUS_PORT:-2567}"
export S3_BUCKET_NAME="${S3_BUCKET_NAME:-codeclashers-avatars}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export REPLICA_SET_NAME="${REPLICA_SET_NAME:-rs0}"

# Build internal MongoDB URI
export MONGODB_URI_INTERNAL="mongodb://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@mongodb.${NAMESPACE}.svc.cluster.local:${MONGODB_PORT}/codeclashers?authSource=admin"

# Apply secrets template
echo "   Applying secrets from template..."
SECRETS_TEMPLATE="$SCRIPT_DIR/../../backend/k8s/secrets/secrets.yaml.template"

if [ ! -f "$SECRETS_TEMPLATE" ]; then
    echo "   ❌ Error: Secrets template not found at $SECRETS_TEMPLATE"
    exit 1
fi

envsubst < "$SECRETS_TEMPLATE" | $KUBECTL apply -f -

# Create GHCR registry secret (if in production or if GHCR_PAT is set)
if [ "$ENV" = "prod" ] || [ -n "$GHCR_PAT" ]; then
    echo "   Creating GHCR registry secret..."
    $KUBECTL delete secret ghcr-secret -n "$NAMESPACE" --ignore-not-found
    
    if [ -n "$GITHUB_ACTOR" ]; then
        DOCKER_USERNAME="$GITHUB_ACTOR"
    else
        DOCKER_USERNAME="${GHCR_USERNAME:-rishabhvenu}"
    fi
    
    $KUBECTL create secret docker-registry ghcr-secret \
        --docker-server=ghcr.io \
        --docker-username="$DOCKER_USERNAME" \
        --docker-password="${GHCR_PAT}" \
        --namespace="$NAMESPACE"
fi

echo ""
echo "✅ Secrets synced successfully"
echo ""
echo "📋 Secrets in namespace:"
$KUBECTL get secrets -n "$NAMESPACE"

