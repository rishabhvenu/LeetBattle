#!/bin/bash
# Environment detection and configuration
# Sources configuration from .env.dev (dev) or GitHub environment (prod)

set -e

# Detect environment
if [ -z "$GITHUB_ACTIONS" ]; then
    export ENV="dev"
    export IS_LOCAL="true"
else
    export ENV="prod"
    export IS_LOCAL="false"
fi

echo "🔧 Configuration Environment: $ENV"

# Set namespace (same for both now)
export NAMESPACE="codeclashers"

# Detect platform
export PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
export ARCH=$(uname -m)

# Set kubectl command based on environment
if [ "$IS_LOCAL" = "true" ]; then
    # Check if k3s is available
    if command -v k3s &> /dev/null; then
        export KUBECTL="k3s kubectl"
        export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
    elif command -v kubectl &> /dev/null; then
        export KUBECTL="kubectl"
    else
        echo "❌ Error: Neither k3s nor kubectl found"
        exit 1
    fi
else
    # Production (GitHub Actions on self-hosted runner)
    export KUBECTL="k3s kubectl"
    export KUBECONFIG="${KUBECONFIG:-/home/ubuntu/.kube/config}"
fi

echo "   Kubectl: $KUBECTL"
echo "   Kubeconfig: $KUBECONFIG"

# Load secrets based on environment
if [ "$IS_LOCAL" = "true" ]; then
    # Load from .env.dev
    ENV_FILE="$(dirname "$0")/../../.env.dev"
    if [ ! -f "$ENV_FILE" ]; then
        echo "❌ Error: $ENV_FILE not found"
        echo "   Copy .env.dev.template to .env.dev and fill in values"
        exit 1
    fi
    
    echo "   Loading secrets from .env.dev"
    set -a  # automatically export all variables
    source "$ENV_FILE"
    set +a
    
    # Set default dev values
    export IMAGE_REGISTRY="${IMAGE_REGISTRY:-local}"
    export IMAGE_TAG="${IMAGE_TAG:-dev}"
    export KUSTOMIZE_OVERLAY="overlays/dev"
else
    # Production - environment variables already set by GitHub Actions
    echo "   Using GitHub Actions environment variables"
    export IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io/rishabhvenu}"
    export IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"
    export KUSTOMIZE_OVERLAY="overlays/prod"
fi

# Set image names
export COLYSEUS_IMAGE="${COLYSEUS_IMAGE:-${IMAGE_REGISTRY}/codeclashers-colyseus:${IMAGE_TAG}}"
export BOTS_IMAGE="${BOTS_IMAGE:-${IMAGE_REGISTRY}/codeclashers-bots:${IMAGE_TAG}}"
export JUDGE0_IMAGE="${JUDGE0_IMAGE:-${IMAGE_REGISTRY}/codeclashers-judge0-api-arm64:${IMAGE_TAG}}"
export JUDGE0_WORKER_IMAGE="${JUDGE0_WORKER_IMAGE:-${IMAGE_REGISTRY}/codeclashers-judge0-worker-arm64:${IMAGE_TAG}}"

echo "   Images:"
echo "     Colyseus: $COLYSEUS_IMAGE"
echo "     Bots: $BOTS_IMAGE"
echo "     Judge0 API: $JUDGE0_IMAGE"
echo "     Judge0 Worker: $JUDGE0_WORKER_IMAGE"

# Verify required variables
REQUIRED_VARS=(
    "REDIS_PASSWORD"
    "MONGODB_URI"
    "INTERNAL_SERVICE_SECRET"
    "BOT_SERVICE_SECRET"
)

for var in "${REQUIRED_VARS[@]}"; do
    VALUE="${!var:-}"
    if [ -z "$VALUE" ]; then
        echo "❌ Error: Required variable $var is not set"
        exit 1
    fi
done

echo "✅ Configuration loaded successfully"

