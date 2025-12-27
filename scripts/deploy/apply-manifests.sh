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
# Only substitute specific deployment variables, NOT bash script variables like ${i}
export ORACLE_VM_IP="${ORACLE_VM_IP:-}"

# Set default values for K8S resource variables if not already set
export K8S_COLYSEUS_REPLICAS="${K8S_COLYSEUS_REPLICAS:-1}"
export K8S_COLYSEUS_CPU_REQUEST="${K8S_COLYSEUS_CPU_REQUEST:-100m}"
export K8S_COLYSEUS_MEMORY_REQUEST="${K8S_COLYSEUS_MEMORY_REQUEST:-256Mi}"
export K8S_COLYSEUS_CPU_LIMIT="${K8S_COLYSEUS_CPU_LIMIT:-500m}"
export K8S_COLYSEUS_MEMORY_LIMIT="${K8S_COLYSEUS_MEMORY_LIMIT:-512Mi}"

export K8S_BOTS_REPLICAS="${K8S_BOTS_REPLICAS:-1}"
export K8S_BOTS_CPU_REQUEST="${K8S_BOTS_CPU_REQUEST:-50m}"
export K8S_BOTS_MEMORY_REQUEST="${K8S_BOTS_MEMORY_REQUEST:-128Mi}"
export K8S_BOTS_CPU_LIMIT="${K8S_BOTS_CPU_LIMIT:-200m}"
export K8S_BOTS_MEMORY_LIMIT="${K8S_BOTS_MEMORY_LIMIT:-256Mi}"

export K8S_JUDGE0_SERVER_REPLICAS="${K8S_JUDGE0_SERVER_REPLICAS:-1}"
export K8S_JUDGE0_SERVER_CPU_REQUEST="${K8S_JUDGE0_SERVER_CPU_REQUEST:-100m}"
export K8S_JUDGE0_SERVER_MEMORY_REQUEST="${K8S_JUDGE0_SERVER_MEMORY_REQUEST:-256Mi}"
export K8S_JUDGE0_SERVER_CPU_LIMIT="${K8S_JUDGE0_SERVER_CPU_LIMIT:-500m}"
export K8S_JUDGE0_SERVER_MEMORY_LIMIT="${K8S_JUDGE0_SERVER_MEMORY_LIMIT:-512Mi}"

export K8S_JUDGE0_WORKER_REPLICAS="${K8S_JUDGE0_WORKER_REPLICAS:-1}"
export K8S_JUDGE0_WORKER_CPU_REQUEST="${K8S_JUDGE0_WORKER_CPU_REQUEST:-200m}"
export K8S_JUDGE0_WORKER_MEMORY_REQUEST="${K8S_JUDGE0_WORKER_MEMORY_REQUEST:-512Mi}"
export K8S_JUDGE0_WORKER_CPU_LIMIT="${K8S_JUDGE0_WORKER_CPU_LIMIT:-1000m}"
export K8S_JUDGE0_WORKER_MEMORY_LIMIT="${K8S_JUDGE0_WORKER_MEMORY_LIMIT:-1Gi}"

export K8S_POSTGRES_REPLICAS="${K8S_POSTGRES_REPLICAS:-1}"
export K8S_POSTGRES_CPU_REQUEST="${K8S_POSTGRES_CPU_REQUEST:-100m}"
export K8S_POSTGRES_MEMORY_REQUEST="${K8S_POSTGRES_MEMORY_REQUEST:-256Mi}"
export K8S_POSTGRES_CPU_LIMIT="${K8S_POSTGRES_CPU_LIMIT:-500m}"
export K8S_POSTGRES_MEMORY_LIMIT="${K8S_POSTGRES_MEMORY_LIMIT:-512Mi}"

export K8S_REDIS_CPU_REQUEST="${K8S_REDIS_CPU_REQUEST:-50m}"
export K8S_REDIS_MEMORY_REQUEST="${K8S_REDIS_MEMORY_REQUEST:-64Mi}"
export K8S_REDIS_CPU_LIMIT="${K8S_REDIS_CPU_LIMIT:-200m}"
export K8S_REDIS_MEMORY_LIMIT="${K8S_REDIS_MEMORY_LIMIT:-128Mi}"

# Standard port defaults
export MONGODB_PORT="${MONGODB_PORT:-27017}"
export JUDGE0_PORT="${JUDGE0_PORT:-2358}"
export REDIS_PORT="${REDIS_PORT:-6379}"

# List of variables to substitute (avoids replacing bash script variables like ${i})
ENVSUBST_VARS='${COLYSEUS_IMAGE} ${BOTS_IMAGE} ${JUDGE0_IMAGE} ${JUDGE0_WORKER_IMAGE} ${IMAGE_TAG} ${IMAGE_REGISTRY} ${ORACLE_VM_IP} ${K8S_COLYSEUS_REPLICAS} ${K8S_COLYSEUS_CPU_REQUEST} ${K8S_COLYSEUS_MEMORY_REQUEST} ${K8S_COLYSEUS_CPU_LIMIT} ${K8S_COLYSEUS_MEMORY_LIMIT} ${K8S_BOTS_REPLICAS} ${K8S_BOTS_CPU_REQUEST} ${K8S_BOTS_MEMORY_REQUEST} ${K8S_BOTS_CPU_LIMIT} ${K8S_BOTS_MEMORY_LIMIT} ${K8S_JUDGE0_SERVER_REPLICAS} ${K8S_JUDGE0_SERVER_CPU_REQUEST} ${K8S_JUDGE0_SERVER_MEMORY_REQUEST} ${K8S_JUDGE0_SERVER_CPU_LIMIT} ${K8S_JUDGE0_SERVER_MEMORY_LIMIT} ${K8S_JUDGE0_WORKER_REPLICAS} ${K8S_JUDGE0_WORKER_CPU_REQUEST} ${K8S_JUDGE0_WORKER_MEMORY_REQUEST} ${K8S_JUDGE0_WORKER_CPU_LIMIT} ${K8S_JUDGE0_WORKER_MEMORY_LIMIT} ${K8S_POSTGRES_REPLICAS} ${K8S_POSTGRES_CPU_REQUEST} ${K8S_POSTGRES_MEMORY_REQUEST} ${K8S_POSTGRES_CPU_LIMIT} ${K8S_POSTGRES_MEMORY_LIMIT} ${K8S_REDIS_CPU_REQUEST} ${K8S_REDIS_MEMORY_REQUEST} ${K8S_REDIS_CPU_LIMIT} ${K8S_REDIS_MEMORY_LIMIT} ${MONGODB_PORT} ${JUDGE0_PORT} ${REDIS_PORT}'

# #region agent log - DEBUG: Verify fix is working
echo "🔍 DEBUG [post-fix]: Checking kubectl kustomize support..."
$KUBECTL kustomize --help > /dev/null 2>&1 && echo "🔍 DEBUG [post-fix]: kubectl kustomize supported ✓" || echo "🔍 DEBUG [post-fix]: kubectl kustomize NOT supported"
# #endregion agent log

# Check if kubectl has built-in kustomize support (kubectl 1.14+)
# Using 'kubectl kustomize --help' which works on all modern kubectl versions
# The old --short flag was removed in kubectl 1.27+
# Note: Using --load-restrictor=LoadRestrictionsNone to allow ../../ paths in overlays
if $KUBECTL kustomize --help > /dev/null 2>&1; then
    # kubectl has built-in kustomize support
    # Use two-step: kustomize build with relaxed restrictions, envsubst for variable substitution, then apply
    echo "   Using kubectl built-in kustomize (with LoadRestrictionsNone for overlay paths)"
    # Delete existing immutable resources before applying (they can't be patched)
    # Jobs are immutable, StatefulSet volumeClaimTemplates are immutable
    echo "   Cleaning up immutable resources..."
    $KUBECTL delete job mongodb-replica-set-init redis-cluster-init -n "$NAMESPACE" --ignore-not-found=true 2>/dev/null || true
    # Note: StatefulSets with changed volumeClaimTemplates need deletion. Using --cascade=orphan to keep pods
    $KUBECTL delete statefulset mongodb redis-cluster -n "$NAMESPACE" --ignore-not-found=true --cascade=orphan 2>/dev/null || true
    $KUBECTL kustomize "$KUSTOMIZE_OVERLAY" --load-restrictor=LoadRestrictionsNone | envsubst "$ENVSUBST_VARS" | $KUBECTL apply -f -
elif command -v kustomize &> /dev/null; then
    echo "   Using standalone kustomize"
    # Delete existing immutable resources before applying (they can't be patched)
    echo "   Cleaning up immutable resources..."
    $KUBECTL delete job mongodb-replica-set-init redis-cluster-init -n "$NAMESPACE" --ignore-not-found=true 2>/dev/null || true
    $KUBECTL delete statefulset mongodb redis-cluster -n "$NAMESPACE" --ignore-not-found=true --cascade=orphan 2>/dev/null || true
    kustomize build "$KUSTOMIZE_OVERLAY" --load-restrictor=LoadRestrictionsNone | envsubst "$ENVSUBST_VARS" | $KUBECTL apply -f -
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

