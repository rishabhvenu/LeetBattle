#!/bin/bash
# Build Docker images for all services
# Tags images based on environment (local:dev or ghcr.io:sha)

set -e

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

echo "🔨 Building Docker images for $ENV environment"

# Navigate to project root
cd "$SCRIPT_DIR/../.."

# Build Colyseus
echo ""
echo "📦 Building Colyseus..."
if [ -f "backend/colyseus/Dockerfile" ]; then
    docker build -t "$COLYSEUS_IMAGE" ./backend/colyseus
    echo "   ✅ Built: $COLYSEUS_IMAGE"
else
    echo "   ⚠️  Skipping: backend/colyseus/Dockerfile not found"
fi

# Build Bots
echo ""
echo "📦 Building Bots..."
if [ -f "backend/bots/Dockerfile" ]; then
    docker build -t "$BOTS_IMAGE" ./backend/bots
    echo "   ✅ Built: $BOTS_IMAGE"
else
    echo "   ⚠️  Skipping: backend/bots/Dockerfile not found"
fi

# Build Judge0 API (ARM64 for Oracle Cloud)
echo ""
echo "📦 Building Judge0 API..."
if [ -f "backend/judge0/api/Dockerfile" ]; then
    if [ "$ENV" = "prod" ]; then
        # Production: cross-build for ARM64
        docker buildx build --platform linux/arm64 \
            -t "$JUDGE0_IMAGE" \
            --load \
            ./backend/judge0/api
    else
        # Dev: build for local architecture
        docker build -t "$JUDGE0_IMAGE" ./backend/judge0/api
    fi
    echo "   ✅ Built: $JUDGE0_IMAGE"
else
    echo "   ⚠️  Skipping: backend/judge0/api/Dockerfile not found"
fi

# Build Judge0 Worker (ARM64 for Oracle Cloud)
echo ""
echo "📦 Building Judge0 Worker..."
if [ -f "backend/judge0/worker/Dockerfile" ]; then
    if [ "$ENV" = "prod" ]; then
        # Production: cross-build for ARM64
        docker buildx build --platform linux/arm64 \
            -t "$JUDGE0_WORKER_IMAGE" \
            --load \
            ./backend/judge0/worker
    else
        # Dev: build for local architecture
        docker build -t "$JUDGE0_WORKER_IMAGE" ./backend/judge0/worker
    fi
    echo "   ✅ Built: $JUDGE0_WORKER_IMAGE"
else
    echo "   ⚠️  Skipping: backend/judge0/worker/Dockerfile not found"
fi

# Push images to registry if in production
if [ "$ENV" = "prod" ] && [ "$IMAGE_REGISTRY" != "local" ]; then
    echo ""
    echo "📤 Pushing images to $IMAGE_REGISTRY..."
    
    docker push "$COLYSEUS_IMAGE" && echo "   ✅ Pushed: $COLYSEUS_IMAGE"
    docker push "$BOTS_IMAGE" && echo "   ✅ Pushed: $BOTS_IMAGE"
    docker push "$JUDGE0_IMAGE" && echo "   ✅ Pushed: $JUDGE0_IMAGE"
    docker push "$JUDGE0_WORKER_IMAGE" && echo "   ✅ Pushed: $JUDGE0_WORKER_IMAGE"
fi

echo ""
echo "✅ Image build complete"

