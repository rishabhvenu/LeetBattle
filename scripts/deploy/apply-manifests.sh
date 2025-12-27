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

# #region agent log - DEBUG: Capture kubectl info for hypothesis testing
echo "🔍 DEBUG [HypA] kubectl version output (--short):"
$KUBECTL version --client --short 2>&1 || echo "   --short flag failed/deprecated"
echo "🔍 DEBUG [HypA] kubectl version output (modern):"
$KUBECTL version --client -o yaml 2>&1 | head -5 || echo "   version command failed"
KUBECTL_VERSION_RAW=$($KUBECTL version --client 2>&1 | head -1)
echo "🔍 DEBUG [HypB] Raw version line: $KUBECTL_VERSION_RAW"
echo "🔍 DEBUG [HypC] KUBECTL variable is: $KUBECTL"
echo "🔍 DEBUG [HypC] which k3s: $(which k3s 2>&1 || echo 'not found')"
echo "🔍 DEBUG [HypD] kustomize installed: $(command -v kustomize 2>&1 || echo 'not found')"
# #endregion agent log

if $KUBECTL version --client --short 2>/dev/null | grep -qE "v1\.(1[4-9]|[2-9][0-9])"; then
    # kubectl 1.14+ has built-in kustomize support
    echo "🔍 DEBUG: Using kubectl apply -k (version check passed)"
    $KUBECTL apply -k "$KUSTOMIZE_OVERLAY"
elif command -v kustomize &> /dev/null; then
    echo "🔍 DEBUG: Using standalone kustomize"
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

