#!/bin/bash
# Start all port-forwards for dev environment

NAMESPACE="codeclashers-dev"

echo "🔌 Starting port-forwards..."

# Kill existing port-forwards
pkill -f "kubectl port-forward" 2>&1 > /dev/null
sleep 1

# Start port-forwards
kubectl port-forward -n "$NAMESPACE" svc/mongodb-dev 27017:27017 > /tmp/mongo-pf.log 2>&1 &
echo "✅ MongoDB:    localhost:27017"

kubectl port-forward -n "$NAMESPACE" svc/redis-cluster-dev 6379:6379 > /tmp/redis-pf.log 2>&1 &
echo "✅ Redis:      localhost:6379"

kubectl port-forward -n "$NAMESPACE" svc/colyseus 2567:2567 > /tmp/colyseus-pf.log 2>&1 &
echo "✅ Colyseus:   localhost:2567"

kubectl port-forward -n "$NAMESPACE" svc/judge0-server 2358:2358 > /tmp/judge0-pf.log 2>&1 &
echo "✅ Judge0:     localhost:2358"

sleep 2
echo ""
echo "Port-forwards started. Check logs in /tmp/*-pf.log if issues occur."
