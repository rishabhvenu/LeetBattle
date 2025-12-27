#!/bin/bash
# Deploy and test refactored services in k3s cluster

set -e

echo "=== Deploying Refactored Services to k3s ==="
echo ""

# Step 1: Build Docker images with refactored code
echo "Step 1: Building Docker images..."
cd /Users/ase/Documents/CodeClashers

echo "  Building Colyseus image..."
docker build -t codeclashers-colyseus:dev ./backend/colyseus 2>&1 | tail -5

echo "  Building Bots image..."
# First, make sure index.new.js is the active version for Docker build
cd backend/bots
if [ -f "index.new.js" ]; then
  cp index.js index.backup.js 2>/dev/null || true
  cp index.new.js index.js
  echo "  ✓ Bot service using refactored modules"
fi
cd ../..
docker build -t codeclashers-bots:dev ./backend/bots 2>&1 | tail -5

echo "✓ Docker images built"
echo ""

# Step 2: Import images into k3d cluster
echo "Step 2: Importing images into k3d cluster..."
k3d image import codeclashers-colyseus:dev -c codeclashers-dev 2>&1 | grep -i "imported\|error" || echo "  (imported)"
k3d image import codeclashers-bots:dev -c codeclashers-dev 2>&1 | grep -i "imported\|error" || echo "  (imported)"
echo "✓ Images imported to k3d"
echo ""

# Step 3: Deploy to k8s
echo "Step 3: Deploying to k8s..."
cd /Users/ase/Documents/CodeClashers/backend/k8s/dev

# Apply the kustomization
kubectl apply -k . 2>&1 | tail -10

echo "✓ Manifests applied"
echo ""

# Step 4: Wait for pods to be ready
echo "Step 4: Waiting for pods to start (up to 120 seconds)..."
kubectl wait --namespace=codeclashers-dev \
  --for=condition=ready pod \
  --selector=app=mongodb-dev \
  --timeout=120s 2>&1 || echo "  (mongodb still starting...)"

kubectl wait --namespace=codeclashers-dev \
  --for=condition=ready pod \
  --selector=app=redis-dev \
  --timeout=120s 2>&1 || echo "  (redis still starting...)"

echo ""
echo "Step 5: Checking pod status..."
kubectl get pods -n codeclashers-dev

echo ""
echo "Step 6: Checking application pods..."
kubectl get pods -n codeclashers-dev -l app=colyseus 2>&1 || echo "  (no colyseus pods yet)"
kubectl get pods -n codeclashers-dev -l app=bots 2>&1 || echo "  (no bot pods yet)"

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "To check logs:"
echo "  kubectl logs -n codeclashers-dev -l app=colyseus --tail=50"
echo "  kubectl logs -n codeclashers-dev -l app=bots --tail=50"

