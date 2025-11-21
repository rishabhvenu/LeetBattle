#!/bin/bash
set -e

# k3s Master Node Bootstrap Script
# This script installs and configures k3s on the master node
# Run this script on a new master node to bootstrap the Kubernetes cluster

echo "=== k3s Master Node Bootstrap ==="

# Check if k3s is already installed
if command -v k3s &> /dev/null; then
    echo "k3s is already installed. Version:"
    k3s --version
    echo "Skipping installation."
    exit 0
fi

echo "Installing k3s master..."

# Install k3s with the following configuration:
# - Disable Traefik (we will use standard Services)
# - Enable privileged containers (required for Judge0 workers)
# - Allow NodePort range 1-65535 (enables standard ports like 27017, 6379, 2567, 2358)
# - Write kubeconfig with proper permissions (readable by runner user)
# - Enable secrets encryption for enhanced security
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik --secrets-encryption --write-kubeconfig-mode 644 --service-node-port-range=1-65535" sh -

# Wait for k3s to be ready
echo "Waiting for k3s to be ready..."
sleep 15

# Create kubeconfig for runner user
sudo mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown -R $USER:$USER ~/.kube

# Add kubectl alias for k3s (if not already present)
if ! grep -q "alias kubectl=\"k3s kubectl\"" ~/.bashrc 2>/dev/null; then
    echo "alias kubectl=\"k3s kubectl\"" >> ~/.bashrc
fi

# Verify installation
echo "Verifying k3s installation..."
k3s kubectl cluster-info
k3s kubectl get nodes

echo "=== k3s master bootstrap complete ==="
echo "You can now use k3s kubectl or kubectl (after sourcing ~/.bashrc)"
echo ""
echo "Next steps:"
echo "1. Sync secrets to Kubernetes using the sync-secrets.yml workflow"
echo "2. Deploy your applications using the deploy-backend.yml workflow"
