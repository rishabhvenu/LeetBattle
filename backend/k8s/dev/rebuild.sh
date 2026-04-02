#!/bin/bash
# Rebuild Docker images and restart all services

set -e

NAMESPACE="codeclashers-dev"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔨 Rebuilding Docker images and restarting services...${NC}"
echo ""

# Check if we're in the right directory structure
if [ ! -f "$PROJECT_ROOT/backend/colyseus/Dockerfile" ]; then
  echo "❌ Error: Cannot find backend/colyseus/Dockerfile"
  echo "   Make sure you're running this from the project root or k8s/dev directory"
  exit 1
fi

# Step 1: Build Docker images
echo -e "${YELLOW}📦 Step 1: Building Docker images...${NC}"
echo ""

cd "$PROJECT_ROOT"

# Build Colyseus
if [ -f "backend/colyseus/Dockerfile" ]; then
  echo -e "${GREEN}Building Colyseus...${NC}"
  docker build -t codeclashers-colyseus:dev ./backend/colyseus
  echo -e "${GREEN}✅ Colyseus image built${NC}"
else
  echo -e "${YELLOW}⚠️  Colyseus Dockerfile not found, skipping...${NC}"
fi

echo ""

# Build Bots
if [ -f "backend/bots/Dockerfile" ]; then
  echo -e "${GREEN}Building Bots...${NC}"
  docker build -f backend/bots/Dockerfile -t codeclashers-bots:dev ./backend
  echo -e "${GREEN}✅ Bots image built${NC}"
else
  echo -e "${YELLOW}⚠️  Bots Dockerfile not found, skipping...${NC}"
fi

echo ""
echo -e "${BLUE}✅ All images built successfully!${NC}"
echo ""

# Step 2: Verify images exist
echo -e "${YELLOW}📋 Step 2: Verifying images...${NC}"
echo ""
docker images | grep -E "codeclashers-(colyseus|bots).*dev" || echo "⚠️  Warning: Some images may not be found"
echo ""

# Step 2b: Load images into k3d cluster if necessary
CLUSTER_NAME="codeclashers-dev"

# Check if k3d cluster exists
if k3d cluster list 2>/dev/null | grep -q "^${CLUSTER_NAME}"; then
  echo -e "${YELLOW}📦 Detected k3d cluster. Importing images...${NC}"
  echo ""
  
  # Import Colyseus image
  if docker images | grep -q "codeclashers-colyseus.*dev"; then
    echo -e "${BLUE}  → Importing codeclashers-colyseus:dev into k3d cluster...${NC}"
    k3d image import codeclashers-colyseus:dev -c "${CLUSTER_NAME}" 2>/dev/null || {
      echo -e "${YELLOW}    ⚠️  Failed to import, trying alternative method...${NC}"
      # Alternative: save and load via tar
      docker save codeclashers-colyseus:dev | k3d image import - -c "${CLUSTER_NAME}" 2>/dev/null || true
    }
  fi
  
  # Import Bots image
  if docker images | grep -q "codeclashers-bots.*dev"; then
    echo -e "${BLUE}  → Importing codeclashers-bots:dev into k3d cluster...${NC}"
    k3d image import codeclashers-bots:dev -c "${CLUSTER_NAME}" 2>/dev/null || {
      echo -e "${YELLOW}    ⚠️  Failed to import, trying alternative method...${NC}"
      # Alternative: save and load via tar
      docker save codeclashers-bots:dev | k3d image import - -c "${CLUSTER_NAME}" 2>/dev/null || true
    }
  fi
  
  echo -e "${GREEN}✅ Images imported into k3d cluster${NC}"
  echo ""
fi

# Step 3: Restart services
cd "$SCRIPT_DIR"

echo -e "${YELLOW}🔄 Step 3: Restarting services...${NC}"
echo ""

# Check if namespace exists
if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
  echo "❌ Namespace $NAMESPACE does not exist!"
  echo "   Run ./setup-dev.sh first"
  exit 1
fi

# Get all deployments
DEPLOYMENTS=$(kubectl get deployments -n $NAMESPACE -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)

if [ -z "$DEPLOYMENTS" ]; then
  echo "❌ No deployments found in namespace $NAMESPACE"
  echo "   Run ./setup-dev.sh first"
  exit 1
fi

# Services that use ReadWriteOnce volumes (need special handling)
RWO_SERVICES="mongodb-dev redis-cluster-dev postgres minio-dev"

echo "Found deployments:"
echo "$DEPLOYMENTS" | tr ' ' '\n' | sed 's/^/  - /'
echo ""

# First, handle services with ReadWriteOnce volumes
echo -e "${BLUE}Handling services with persistent volumes...${NC}"
for deployment in $RWO_SERVICES; do
  if echo "$DEPLOYMENTS" | grep -q "$deployment"; then
    echo "  ⏸️  Skipping $deployment (has persistent volume)"
  fi
done

# Restart Colyseus and Bots specifically (since we rebuilt their images)
echo ""
echo -e "${BLUE}Restarting Colyseus and Bots (images rebuilt)...${NC}"
for service in colyseus bots; do
  if echo "$DEPLOYMENTS" | grep -q "$service"; then
    echo -e "${GREEN}🔄 Restarting $service...${NC}"
    kubectl rollout restart deployment/$service -n $NAMESPACE
  fi
done

# Optionally restart other services (comment out if you only want to restart rebuilt ones)
# echo ""
# echo "Restarting other services..."
# for deployment in $DEPLOYMENTS; do
#   if ! echo "$RWO_SERVICES colyseus bots" | grep -q "$deployment"; then
#     echo "  🔄 Restarting $deployment..."
#     kubectl rollout restart deployment/$deployment -n $NAMESPACE
#   fi
# done

# Also restart DaemonSets (node-exporter)
DAEMONSETS=$(kubectl get daemonsets -n $NAMESPACE -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [ -n "$DAEMONSETS" ]; then
  echo ""
  echo -e "${BLUE}Restarting DaemonSets...${NC}"
  for daemonset in $DAEMONSETS; do
    echo -e "${GREEN}🔄 Restarting $daemonset...${NC}"
    kubectl rollout restart daemonset/$daemonset -n $NAMESPACE
  done
fi

echo ""
echo -e "${YELLOW}⏳ Waiting for rollouts to complete...${NC}"
echo ""

# Wait for Colyseus and Bots rollouts
for service in colyseus bots; do
  if echo "$DEPLOYMENTS" | grep -q "$service"; then
    echo -e "${GREEN}Waiting for $service...${NC}"
    kubectl rollout status deployment/$service -n $NAMESPACE --timeout=120s || echo "    ⚠️  $service may still be restarting"
  fi
done

# Wait for DaemonSets
if [ -n "$DAEMONSETS" ]; then
  for daemonset in $DAEMONSETS; do
    echo -e "${GREEN}Waiting for $daemonset...${NC}"
    kubectl rollout status daemonset/$daemonset -n $NAMESPACE --timeout=120s || echo "    ⚠️  $daemonset may still be restarting"
  done
fi

echo ""
echo -e "${GREEN}✅ Rebuild and restart complete!${NC}"
echo ""
echo "📊 Current pod status:"
kubectl get pods -n $NAMESPACE
echo ""
echo -e "${BLUE}💡 Tip: Use './logs.sh colyseus' or './logs.sh bots' to view logs${NC}"

