#!/bin/bash
# Quick pod status checker

set -e

NAMESPACE="codeclashers-dev"

echo "📊 Current Pod Status in $NAMESPACE"
echo ""

# Basic pod status
echo "=== Pod Status ==="
kubectl get pods -n $NAMESPACE

echo ""
echo "=== Pod Details ==="
kubectl get pods -n $NAMESPACE -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,READY:.status.containerStatuses[0].ready,RESTARTS:.status.containerStatuses[0].restartCount,AGE:.metadata.creationTimestamp

echo ""
echo "=== Pod Resource Usage ==="
kubectl top pods -n $NAMESPACE 2>/dev/null || echo "Metrics not available (metrics-server may not be installed)"

echo ""
echo "=== Recent Pod Events ==="
kubectl get events -n $NAMESPACE --sort-by='.lastTimestamp' | tail -10

