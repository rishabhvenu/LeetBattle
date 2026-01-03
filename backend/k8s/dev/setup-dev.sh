#!/bin/bash
# Setup script for local development with k3d

set -e

echo "🚀 Setting up CodeClashers for local development with k3d"
echo ""

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
  echo "❌ kubectl not found. Please install kubectl."
  exit 1
fi

# Check if k3d cluster exists and is accessible
if ! kubectl cluster-info &> /dev/null; then
  echo "❌ Cannot connect to Kubernetes cluster."
  echo ""
  echo "   Please create a k3d cluster first:"
  echo "   cd backend/k8s/dev"
  echo "   ./setup-k3d-cluster.sh"
  exit 1
fi

echo "✅ Connected to Kubernetes cluster"
kubectl cluster-info | head -1
echo ""

# Create secrets
echo "📝 Creating development secrets..."
cd "$(dirname "$0")"
./create-dev-secrets.sh

# Build and deploy
echo ""
echo "🔨 Building and deploying services..."

# Check if we need to build images locally
if [ "${BUILD_IMAGES:-true}" = "true" ]; then
  echo "📦 Building Docker images..."
  cd ../../../
  
  # Build Colyseus
  if [ -f "backend/colyseus/Dockerfile" ]; then
    echo "  Building Colyseus..."
    docker build -t codeclashers-colyseus:dev ./backend/colyseus
  fi
  
  # Build Bots
  if [ -f "backend/bots/Dockerfile" ]; then
    echo "  Building Bots..."
    docker build -t codeclashers-bots:dev ./backend/bots
  fi
fi

# Deploy with kustomize
echo ""
echo "🚀 Deploying to Kubernetes..."
cd backend/k8s/dev

# Check if kustomize is available (kubectl 1.14+ has built-in support)
if kubectl version --client --short 2>/dev/null | grep -qE "v1\.(1[4-9]|[2-9][0-9])"; then
  # kubectl 1.14+ has built-in kustomize support
  kubectl apply -k .
elif command -v kustomize &> /dev/null; then
  kustomize build . | kubectl apply -f -
else
  echo "⚠️  kustomize not found. Trying kubectl apply -k anyway..."
  kubectl apply -k . || {
    echo "❌ Failed. Please install kustomize:"
    echo "   brew install kustomize"
    exit 1
  }
fi

echo ""
echo "⏳ Waiting for services to be ready..."
kubectl wait --namespace=codeclashers-dev \
  --for=condition=ready pod \
  --selector=app=mongodb-dev \
  --timeout=300s || true

kubectl wait --namespace=codeclashers-dev \
  --for=condition=ready pod \
  --selector=app=redis-cluster-dev \
  --timeout=300s || true

kubectl wait --namespace=codeclashers-dev \
  --for=condition=ready pod \
  --selector=app=minio-dev \
  --timeout=300s || true

echo ""
echo "✅ Setup complete!"
echo ""
echo "📊 Service Status:"
kubectl get pods -n codeclashers-dev
echo ""
echo "🌐 Access Services:"
echo ""
echo "  Option 1: Via k3d loadbalancer (standard ports - recommended):"
echo "    MongoDB:    localhost:27017"
echo "    Redis:      localhost:6379"
echo "    Colyseus:   ws://localhost:2567 or http://localhost:2567"
echo "    Judge0:     http://localhost:2358"
echo "    MinIO API:  localhost:9000"
echo "    MinIO UI:   http://localhost:9001 (minioadmin/minioadmin123)"
echo ""
if [ "${AUTO_PORT_FORWARD:-false}" = "true" ]; then
  echo "  🔄 Starting automatic port-forward daemon..."
  cd "$(dirname "$0")"
  ./port-forward-daemon.sh > /dev/null 2>&1 &
  echo "  ✅ Port-forward daemon started in background"
  echo "     To stop: ./stop-port-forward.sh"
else
  echo "  Option 2: Start port-forward daemon (runs in background, auto-restarts):"
  echo "    cd backend/k8s/dev && ./port-forward-daemon.sh"
  echo ""
  echo "  Option 3: Use port-forwarding for standard ports (interactive):"
  echo "    cd backend/k8s/dev && ./port-forward.sh"
fi
echo ""
echo ""
echo "📝 Useful Commands:"
echo "  View logs:              kubectl logs -n codeclashers-dev -l app=<service-name>"
echo "  Delete namespace:       kubectl delete namespace codeclashers-dev"
echo "  Start port-forward:    ./port-forward-daemon.sh  (background daemon)"
echo "  Stop port-forward:     ./stop-port-forward.sh"
echo "  Port forward (manual): kubectl port-forward -n codeclashers-dev svc/<service-name> <local-port>:<service-port>"
echo ""
echo "💡 Tip: To auto-start port-forward daemon on setup, run:"
echo "   AUTO_PORT_FORWARD=true ./setup-dev.sh"

