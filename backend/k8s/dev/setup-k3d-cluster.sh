#!/bin/bash
# Setup script for k3d cluster for local development
# This script creates a k3d cluster with proper port mappings and configuration

set -e

CLUSTER_NAME="codeclashers-dev"

echo "🚀 Setting up k3d cluster for CodeClashers development"
echo ""

# Check if k3d is installed
if ! command -v k3d &> /dev/null; then
  echo "❌ k3d not found. Please install k3d:"
  echo "   brew install k3d"
  echo "   or visit: https://k3d.io/"
  exit 1
fi

# Check if cluster already exists
if k3d cluster list | grep -q "^${CLUSTER_NAME}"; then
  echo "⚠️  Cluster '${CLUSTER_NAME}' already exists."
  read -p "Do you want to delete and recreate it? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🗑️  Deleting existing cluster..."
    k3d cluster delete "${CLUSTER_NAME}"
  else
    echo "✅ Using existing cluster '${CLUSTER_NAME}'"
    echo ""
    echo "To connect to the cluster, ensure your kubeconfig is set:"
    echo "  k3d kubeconfig merge ${CLUSTER_NAME} --kubeconfig-switch-context"
    exit 0
  fi
fi

echo "📦 Creating k3d cluster '${CLUSTER_NAME}'..."
echo ""

# Create k3d cluster with:
# - Port mappings for all services via loadbalancer
# - Privileged containers enabled (default in k3d, required for Judge0 workers)
# - NodePort range 1-65535 (allows standard ports)
# - Secrets encryption enabled (server nodes only)
k3d cluster create "${CLUSTER_NAME}" \
  --port "27017:32017@loadbalancer" \
  --port "6379:30637@loadbalancer" \
  --port "2567:30267@loadbalancer" \
  --port "2358:32358@loadbalancer" \
  --port "9000:30900@loadbalancer" \
  --port "9001:30901@loadbalancer" \
  --port "3030:30300@loadbalancer" \
  --port "9090:30909@loadbalancer" \
  --port "3100:31000@loadbalancer" \
  --k3s-arg "--secrets-encryption@server:0" \
  --k3s-arg "--service-node-port-range=1-65535@server:0" \
  --wait

echo ""
echo "✅ k3d cluster '${CLUSTER_NAME}' created successfully!"
echo ""

# Merge kubeconfig and switch context
echo "🔧 Configuring kubectl..."
k3d kubeconfig merge "${CLUSTER_NAME}" --kubeconfig-switch-context

# Verify cluster is accessible
echo "🔍 Verifying cluster connection..."
if kubectl cluster-info &> /dev/null; then
  echo "✅ Successfully connected to cluster"
  kubectl cluster-info | head -1
  echo ""
  kubectl get nodes
  echo ""
  echo "🎉 k3d cluster is ready!"
  echo ""
  echo "💾 Volume Persistence:"
  echo "  - Data persists across pod restarts ✅"
  echo "  - Data persists across cluster stop/start ✅"
  echo "  - Data persists across Docker restarts ✅"
  echo "  - ⚠️  Data is LOST if you delete the cluster (k3d cluster delete)"
  echo ""
  echo "Next steps:"
  echo "  1. Run: cd backend/k8s/dev && ./setup-dev.sh"
  echo "  2. Or manually: ./create-dev-secrets.sh && kubectl apply -k ."
else
  echo "❌ Failed to connect to cluster"
  exit 1
fi

