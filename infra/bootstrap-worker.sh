#!/bin/bash
set -e

# k3s Worker Node Bootstrap Script
# This script installs and configures k3s on a worker node
# Run this script on a new worker node to join it to the cluster

echo "=== k3s Worker Node Bootstrap ==="

# Check if k3s is already installed
if command -v k3s-agent &> /dev/null; then
    echo "k3s-agent is already installed."
    echo "Skipping installation."
    exit 0
fi

# Check for required environment variables
if [ -z "$K3S_URL" ]; then
    echo "ERROR: K3S_URL environment variable is required"
    echo "Example: export K3S_URL=https://<master-ip>:6443"
    exit 1
fi

if [ -z "$K3S_TOKEN" ]; then
    echo "ERROR: K3S_TOKEN environment variable is required"
    echo "Get the token from the master node: sudo cat /var/lib/rancher/k3s/server/node-token"
    exit 1
fi

echo "Installing k3s worker..."
echo "Master URL: $K3S_URL"

# Install k3s-agent with configuration
# - Enable privileged containers (required for Judge0 workers)
# - Set master URL and token for joining
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" K3S_URL="$K3S_URL" K3S_TOKEN="$K3S_TOKEN" sh -

# Wait for k3s-agent to start
echo "Waiting for k3s-agent to start..."
sleep 15

# Verify installation
echo "Verifying k3s-agent installation..."
systemctl status k3s-agent --no-pager || true

echo "=== k3s worker bootstrap complete ==="
echo "Worker node has joined the cluster"
echo ""
echo "On the master node, verify with: kubectl get nodes"

