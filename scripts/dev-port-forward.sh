#!/bin/bash
# Port-forward script for CodeClashers dev services
# Run this to expose K8s services locally

set -e

NAMESPACE="codeclashers-dev"
PIDS_FILE="/tmp/codeclashers-port-forwards.pids"

# Function to cleanup on exit
cleanup() {
    echo "Cleaning up port-forwards..."
    if [ -f "$PIDS_FILE" ]; then
        while read pid; do
            kill $pid 2>/dev/null || true
        done < "$PIDS_FILE"
        rm -f "$PIDS_FILE"
    fi
    pkill -f "kubectl port-forward.*codeclashers" || true
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo "🚀 Starting port-forwards for CodeClashers services..."
echo ""

# MongoDB
echo "📦 MongoDB: localhost:27017"
kubectl port-forward -n "$NAMESPACE" svc/mongodb 27017:27017 > /tmp/mongodb-pf.log 2>&1 &
echo $! >> "$PIDS_FILE"
sleep 1

# Redis (if needed)
# Note: Using port 6380 to avoid conflict with local Redis on 6379
# If you don't have local Redis, you can change this to 6379:6379
echo "📦 Redis: localhost:6380"
kubectl port-forward -n "$NAMESPACE" svc/redis 6380:6379 > /tmp/redis-pf.log 2>&1 &
echo $! >> "$PIDS_FILE"
sleep 1

echo ""
echo "✅ Port-forwards running!"
echo ""
echo "Services available at:"
echo "  MongoDB: mongodb://admin:admin123@localhost:27017/codeclashers?authSource=admin"
echo "  Redis:   redis://:redis_dev_password_123@localhost:6380"
echo ""
echo "Press Ctrl+C to stop all port-forwards..."

# Keep script running
wait


