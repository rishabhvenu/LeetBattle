#!/bin/bash
# One-command development environment setup
# This script sets up the complete dev environment matching production

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🚀 CodeClashers Development Setup"
echo "=================================="
echo ""

# Step 1: Check/Install k3s
echo "📦 Step 1/5: Checking k3s installation..."
if ! command -v k3s &> /dev/null && ! docker ps | grep -q k3s-server; then
    echo "   k3s not found. Installing..."
    "$SCRIPT_DIR/setup/install-k3s.sh"
else
    echo "   ✅ k3s is already installed"
fi
echo ""

# Step 2: Setup environment files
echo "📝 Step 2/5: Setting up environment configuration..."
cd "$PROJECT_ROOT"

if [ ! -f .env.dev ]; then
    echo "   Creating .env.dev from template..."
    cp .env.dev.template .env.dev
    echo "   ⚠️  IMPORTANT: Edit .env.dev and fill in your values"
    echo "   Required values:"
    echo "     - OPENAI_API_KEY (get from https://platform.openai.com/api-keys)"
    echo "     - Other secrets (defaults are fine for local dev)"
    echo ""
    read -p "Press Enter after editing .env.dev (or Ctrl+C to exit)..."
else
    echo "   ✅ .env.dev already exists"
fi

if [ ! -f .secrets.dev ]; then
    echo "   Creating .secrets.dev from template..."
    cp .secrets.dev.template .secrets.dev
    echo "   ℹ️  Using same values as .env.dev for secrets"
else
    echo "   ✅ .secrets.dev already exists"
fi
echo ""

# Step 3: Build Docker images
echo "🔨 Step 3/5: Building Docker images..."
"$SCRIPT_DIR/deploy/build-images.sh"
echo ""

# Step 4: Deploy to Kubernetes
echo "🚀 Step 4/5: Deploying to Kubernetes..."
"$SCRIPT_DIR/deploy/sync-secrets.sh"
"$SCRIPT_DIR/deploy/apply-manifests.sh"
echo ""

# Step 5: Health check
echo "🏥 Step 5/5: Running health checks..."
"$SCRIPT_DIR/deploy/health-check.sh"
echo ""

# Show service URLs
echo "✅ Development environment is ready!"
echo ""
echo "📊 Service URLs:"
echo "  MongoDB:    mongodb://admin:admin123@localhost:27017/codeclashers"
echo "  Redis:      localhost:6379 (password: see .env.dev)"
echo "  Colyseus:   http://localhost:2567"
echo "  Judge0:     http://localhost:2358"
echo "  MinIO:      http://localhost:9000 (console: http://localhost:9001)"
echo ""
echo "🎮 Start the frontend:"
echo "  cd client"
echo "  npm install"
echo "  npm run dev"
echo ""
echo "📚 Useful commands:"
echo "  View logs:       kubectl logs -n codeclashers -f deployment/colyseus"
echo "  Restart service: kubectl rollout restart deployment/colyseus -n codeclashers"
echo "  Rebuild & redeploy: ./scripts/deploy/build-images.sh && ./scripts/deploy/apply-manifests.sh"
echo "  Run workflows locally: ./scripts/act-run.sh"
echo ""
echo "💡 Tips:"
echo "  - Edit code in backend/colyseus or backend/bots"
echo "  - Rebuild images and redeploy to see changes"
echo "  - Services automatically restart on crash"
echo "  - Use kubectl to inspect pod logs and status"

