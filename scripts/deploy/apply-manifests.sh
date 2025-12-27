#!/bin/bash
# Apply Kubernetes manifests
# Uses kustomize overlays for environment-specific configuration

set -e

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

echo "🚀 Deploying to Kubernetes ($ENV environment)"
echo "   Namespace: $NAMESPACE"
echo "   Overlay: $KUSTOMIZE_OVERLAY"

# Navigate to k8s directory
cd "$SCRIPT_DIR/../../backend/k8s"

# Check if overlay exists
if [ ! -d "$KUSTOMIZE_OVERLAY" ]; then
    echo "   ❌ Error: Overlay directory $KUSTOMIZE_OVERLAY not found"
    exit 1
fi

# Apply manifests using kustomize
echo ""
echo "📦 Applying Kustomize overlay: $KUSTOMIZE_OVERLAY"

# Export variables for envsubst in kustomize
export ORACLE_VM_IP="${ORACLE_VM_IP:-}"

if $KUBECTL version --client --short 2>/dev/null | grep -qE "v1\.(1[4-9]|[2-9][0-9])"; then
    # kubectl 1.14+ has built-in kustomize support
    $KUBECTL apply -k "$KUSTOMIZE_OVERLAY"
elif command -v kustomize &> /dev/null; then
    kustomize build "$KUSTOMIZE_OVERLAY" | envsubst | $KUBECTL apply -f -
else
    echo "   ❌ Error: kustomize not found and kubectl version doesn't support -k flag"
    echo "   Please install kustomize: https://kubectl.docs.kubernetes.io/installation/kustomize/"
    exit 1
fi

echo ""
echo "✅ Manifests applied successfully"
echo ""
echo "📊 Pod Status:"
$KUBECTL get pods -n "$NAMESPACE"

