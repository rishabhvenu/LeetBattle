#!/bin/bash
# Safe restart script that handles ReadWriteOnce volumes properly

set -e

NAMESPACE="codeclashers-dev"

echo "🔄 Safely restarting all services in namespace: $NAMESPACE"
echo ""

# Services that use ReadWriteOnce volumes (need special handling)
RWO_SERVICES="mongodb-dev redis-dev postgres minio-dev"

# Monitoring services (handled as regular deployments, no persistent volumes in dev)
MONITORING_SERVICES="prometheus grafana"

# Get all deployments
DEPLOYMENTS=$(kubectl get deployments -n $NAMESPACE -o jsonpath='{.items[*].metadata.name}')

if [ -z "$DEPLOYMENTS" ]; then
  echo "❌ No deployments found in namespace $NAMESPACE"
  exit 1
fi

echo "📦 Found deployments:"
echo "$DEPLOYMENTS" | tr ' ' '\n' | sed 's/^/  - /'
echo ""

# First, handle services with ReadWriteOnce volumes (scale down, then up)
echo "🔄 Handling services with ReadWriteOnce volumes..."
for deployment in $RWO_SERVICES; do
  if echo "$DEPLOYMENTS" | grep -q "$deployment"; then
    echo "  🔄 Scaling down $deployment..."
    kubectl scale deployment/$deployment -n $NAMESPACE --replicas=0
    echo "  ⏳ Waiting for pods to terminate..."
    kubectl wait --for=delete pod -l app=$deployment -n $NAMESPACE --timeout=60s 2>/dev/null || true
    sleep 2
    echo "  ⬆️  Scaling up $deployment..."
    kubectl scale deployment/$deployment -n $NAMESPACE --replicas=1
  fi
done

echo ""
echo "🔄 Restarting other services..."

# Restart other services normally
for deployment in $DEPLOYMENTS; do
  if ! echo "$RWO_SERVICES" | grep -q "$deployment"; then
    echo "  🔄 Restarting $deployment..."
    kubectl rollout restart deployment/$deployment -n $NAMESPACE
  fi
done

echo ""
echo "⏳ Waiting for all deployments to be ready..."
echo ""

# Wait for all rollouts to complete
for deployment in $DEPLOYMENTS; do
  echo "  Waiting for $deployment..."
  kubectl rollout status deployment/$deployment -n $NAMESPACE --timeout=120s || echo "    ⚠️  $deployment may still be restarting"
done

# Also restart DaemonSets (node-exporter)
DAEMONSETS=$(kubectl get daemonsets -n $NAMESPACE -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [ -n "$DAEMONSETS" ]; then
  echo ""
  echo "🔄 Restarting DaemonSets..."
  for daemonset in $DAEMONSETS; do
    echo "  🔄 Restarting $daemonset..."
    kubectl rollout restart daemonset/$daemonset -n $NAMESPACE
  done
fi

echo ""
echo "✅ All services restarted!"
echo ""
echo "📊 Current status:"
kubectl get pods -n $NAMESPACE

