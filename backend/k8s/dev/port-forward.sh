#!/bin/bash
# Port forwarding script for k3d Kubernetes cluster
# This allows accessing services on standard ports via port-forwarding

set -e

CONTEXT="k3d-codeclashers-dev"
NAMESPACE="codeclashers-dev"

echo "🔌 Setting up port forwarding for standard ports..."
echo "   Press Ctrl+C to stop all port forwards"
echo ""

# Function to cleanup background jobs on exit
cleanup() {
  echo ""
  echo "🛑 Stopping port forwards..."
  jobs -p | xargs -r kill
  exit 0
}

trap cleanup SIGINT SIGTERM

# Port forward in background
kubectl --context "$CONTEXT" port-forward -n "$NAMESPACE" svc/mongodb-dev 27017:27017 > /dev/null 2>&1 &
echo "✅ MongoDB:    localhost:27017"

kubectl --context "$CONTEXT" port-forward -n "$NAMESPACE" svc/redis-cluster-dev 6379:6379 > /dev/null 2>&1 &
echo "✅ Redis:      localhost:6379"

kubectl --context "$CONTEXT" port-forward -n "$NAMESPACE" svc/colyseus 2567:2567 > /dev/null 2>&1 &
echo "✅ Colyseus:   localhost:2567"

kubectl --context "$CONTEXT" port-forward -n "$NAMESPACE" svc/judge0-server 2358:2358 > /dev/null 2>&1 &
echo "✅ Judge0:     localhost:2358"

kubectl --context "$CONTEXT" port-forward -n "$NAMESPACE" svc/minio-dev 9000:9000 > /dev/null 2>&1 &
echo "✅ MinIO API:  localhost:9000"

kubectl --context "$CONTEXT" port-forward -n "$NAMESPACE" svc/minio-dev 9001:9001 > /dev/null 2>&1 &
echo "✅ MinIO UI:   localhost:9001"

kubectl --context "$CONTEXT" port-forward -n "$NAMESPACE" svc/grafana 3030:3030 > /dev/null 2>&1 &
echo "✅ Grafana:    localhost:3030"

kubectl --context "$CONTEXT" port-forward -n "$NAMESPACE" svc/prometheus 9090:9090 > /dev/null 2>&1 &
echo "✅ Prometheus: localhost:9090"

kubectl --context "$CONTEXT" port-forward -n "$NAMESPACE" svc/loki 3100:3100 > /dev/null 2>&1 &
echo "✅ Loki:       localhost:3100"
echo ""
echo "All services are now accessible on standard ports!"
echo "Keep this terminal open. Press Ctrl+C to stop."
echo ""

# Wait for user to stop
wait

