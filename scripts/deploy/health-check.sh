#!/bin/bash
# Health check for deployed services
# Waits for pods to be ready and validates endpoints

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Minimal config for health check (doesn't require secrets)
# Use environment variables if set, otherwise detect
export NAMESPACE="${NAMESPACE:-codeclashers}"
export KUBECONFIG="${KUBECONFIG:-/home/ubuntu/.kube/config}"

# Set kubectl command
if [ -n "$GITHUB_ACTIONS" ]; then
    export KUBECTL="k3s kubectl"
elif command -v k3s &> /dev/null; then
    export KUBECTL="k3s kubectl"
elif command -v kubectl &> /dev/null; then
    export KUBECTL="kubectl"
else
    echo "❌ Error: Neither k3s nor kubectl found"
    exit 1
fi

echo "🏥 Running health checks for $NAMESPACE namespace"

# Wait for deployments to be ready
DEPLOYMENTS=("colyseus" "bots" "judge0-server" "judge0-worker" "postgres")
TIMEOUT=300

echo ""
echo "⏳ Waiting for deployments to be ready (timeout: ${TIMEOUT}s)..."

for deployment in "${DEPLOYMENTS[@]}"; do
    echo "   Checking $deployment..."
    if $KUBECTL get deployment "$deployment" -n "$NAMESPACE" &> /dev/null; then
        $KUBECTL rollout status deployment/"$deployment" -n "$NAMESPACE" --timeout="${TIMEOUT}s" || {
            echo "   ❌ Deployment $deployment failed to become ready"
            echo ""
            echo "   Pod logs:"
            $KUBECTL logs -n "$NAMESPACE" deployment/"$deployment" --tail=50 || true
            exit 1
        }
        echo "   ✅ $deployment is ready"
    else
        echo "   ⚠️  Deployment $deployment not found (may not be deployed yet)"
    fi
done

# Wait for StatefulSets
STATEFULSETS=("mongodb" "redis-cluster")

echo ""
echo "⏳ Waiting for StatefulSets to be ready..."

for sts in "${STATEFULSETS[@]}"; do
    echo "   Checking $sts..."
    if $KUBECTL get statefulset "$sts" -n "$NAMESPACE" &> /dev/null; then
        $KUBECTL rollout status statefulset/"$sts" -n "$NAMESPACE" --timeout="${TIMEOUT}s" || {
            echo "   ❌ StatefulSet $sts failed to become ready"
            echo ""
            echo "   Pod logs:"
            $KUBECTL logs -n "$NAMESPACE" statefulset/"$sts" --tail=50 || true
            exit 1
        }
        echo "   ✅ $sts is ready"
    else
        echo "   ⚠️  StatefulSet $sts not found (may use single instance in dev)"
    fi
done

# Check service endpoints
echo ""
echo "🔍 Validating service endpoints..."

SERVICES=("colyseus" "redis-cluster" "mongodb" "judge0-server" "postgres")

for service in "${SERVICES[@]}"; do
    if $KUBECTL get service "$service" -n "$NAMESPACE" &> /dev/null; then
        ENDPOINTS=$($KUBECTL get endpoints "$service" -n "$NAMESPACE" -o jsonpath='{.subsets[*].addresses[*].ip}' | wc -w | tr -d ' ')
        if [ "$ENDPOINTS" -gt 0 ]; then
            echo "   ✅ $service: $ENDPOINTS endpoint(s)"
        else
            echo "   ⚠️  $service: No endpoints ready yet"
        fi
    fi
done

# Get all pods status
echo ""
echo "📊 Final Pod Status:"
$KUBECTL get pods -n "$NAMESPACE"

echo ""
echo "✅ Health check complete"

