#!/bin/bash
# Install k3s for local development
# Replicates production k3s setup on Oracle VM

set -e

echo "🚀 Installing k3s for local development"
echo ""

# Detect platform
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

echo "Platform: $PLATFORM"
echo "Architecture: $ARCH"
echo ""

# Check if k3s is already installed
if command -v k3s &> /dev/null; then
    echo "✅ k3s is already installed"
    k3s --version
    echo ""
    read -p "Do you want to reinstall? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping installation"
        exit 0
    fi
fi

if [ "$PLATFORM" = "darwin" ]; then
    echo "📦 macOS detected - installing k3s via Docker (k3d-style but with k3s binary)"
    echo ""
    
    # Check if Docker is running
    if ! docker info &> /dev/null; then
        echo "❌ Error: Docker is not running"
        echo "   Please start Docker Desktop and try again"
        exit 1
    fi
    
    # Use rancher/k3s image to run k3s in Docker
    echo "Starting k3s container..."
    
    # Stop existing k3s container if it exists
    docker stop k3s-server 2>/dev/null || true
    docker rm k3s-server 2>/dev/null || true
    
    # Run k3s in Docker with same flags as production
    docker run -d \
        --name k3s-server \
        --privileged \
        --restart=unless-stopped \
        -p 6443:6443 \
        -p 80:80 \
        -p 443:443 \
        -p 27017:27017 \
        -p 6379:6379 \
        -p 2567:2567 \
        -p 2358:2358 \
        -p 9000:9000 \
        -p 9001:9001 \
        -v k3s-server:/var/lib/rancher/k3s \
        rancher/k3s:latest \
        server \
        --disable traefik \
        --secrets-encryption \
        --service-node-port-range=1-65535 \
        --kube-apiserver-arg service-node-port-range=1-65535
    
    # Wait for k3s to start
    echo "Waiting for k3s to start..."
    sleep 10
    
    # Get kubeconfig from container
    mkdir -p ~/.kube
    docker cp k3s-server:/etc/rancher/k3s/k3s.yaml ~/.kube/config
    
    # Update kubeconfig to use localhost
    sed -i '' 's/127.0.0.1/host.docker.internal/g' ~/.kube/config || \
        sed -i '' 's/server: https:\/\/.*:6443/server: https:\/\/127.0.0.1:6443/g' ~/.kube/config
    
    echo ""
    echo "✅ k3s is running in Docker"
    echo ""
    echo "💡 To access k3s:"
    echo "   kubectl cluster-info"
    echo "   kubectl get nodes"
    echo ""
    echo "💡 To stop k3s:"
    echo "   docker stop k3s-server"
    echo ""
    echo "💡 To remove k3s:"
    echo "   docker stop k3s-server && docker rm k3s-server"
    
elif [ "$PLATFORM" = "linux" ]; then
    echo "🐧 Linux detected - installing k3s natively"
    echo ""
    
    # Check if running with sudo
    if [ "$EUID" -ne 0 ]; then
        echo "❌ Error: This script must be run with sudo on Linux"
        echo "   Run: sudo $0"
        exit 1
    fi
    
    # Install k3s with same configuration as production
    echo "Installing k3s..."
    curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik --secrets-encryption --write-kubeconfig-mode 644 --service-node-port-range=1-65535" sh -
    
    # Wait for k3s to be ready
    echo "Waiting for k3s to be ready..."
    sleep 15
    
    # Create kubeconfig for current user
    mkdir -p ~/.kube
    cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
    chown $SUDO_USER:$SUDO_USER ~/.kube/config
    
    echo ""
    echo "✅ k3s installed successfully"
    echo ""
    echo "💡 To use k3s:"
    echo "   kubectl cluster-info"
    echo "   # OR"
    echo "   k3s kubectl cluster-info"
    
else
    echo "❌ Error: Unsupported platform: $PLATFORM"
    echo "   This script supports macOS (via Docker) and Linux (native)"
    exit 1
fi

# Verify installation
echo ""
echo "🔍 Verifying k3s installation..."

if [ "$PLATFORM" = "darwin" ]; then
    # On macOS, use kubectl with the kubeconfig we set up
    if kubectl cluster-info &> /dev/null; then
        echo "✅ k3s is accessible via kubectl"
        kubectl cluster-info | head -1
        kubectl get nodes
    else
        echo "⚠️  kubectl cannot connect to k3s"
        echo "   Kubeconfig: ~/.kube/config"
        echo "   Try: export KUBECONFIG=~/.kube/config"
    fi
else
    # On Linux, verify k3s directly
    if k3s kubectl cluster-info &> /dev/null; then
        echo "✅ k3s is running"
        k3s kubectl cluster-info | head -1
        k3s kubectl get nodes
    else
        echo "❌ k3s is not responding"
        exit 1
    fi
fi

echo ""
echo "🎉 k3s setup complete!"
echo ""
echo "Next steps:"
echo "  1. Run: cd $(dirname "$0")/../.. && ./scripts/dev-setup.sh"
echo "  2. Or manually deploy: ./scripts/deploy/sync-secrets.sh && ./scripts/deploy/apply-manifests.sh"

