#!/bin/bash
set -e

# k3s Installation Script for Oracle VM
# This script is idempotent and can be run multiple times safely

echo "=== k3s Installation Script ==="

# Check if k3s is already installed
if command -v k3s &> /dev/null; then
    echo "k3s is already installed. Version:"
    k3s --version
    echo "Skipping installation."
    exit 0
fi

echo "Installing k3s..."

# Install k3s with the following configuration:
# - Disable Traefik (we'll use standard Services)
# - Enable privileged containers (required for Judge0 workers)
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik --secrets-encryption" sh -

# Wait for k3s to be ready
echo "Waiting for k3s to be ready..."
sleep 10

# Create kubeconfig for non-root user
sudo mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown -R $USER:$USER ~/.kube

# Add kubectl alias for k3s
echo 'alias kubectl="k3s kubectl"' >> ~/.bashrc
export kubectl="k3s kubectl"

# Verify installation
echo "Verifying k3s installation..."
k3s kubectl cluster-info
k3s kubectl get nodes

echo "=== k3s installation complete ==="
echo "You can now use 'k3s kubectl' or 'kubectl' (after sourcing ~/.bashrc)"

