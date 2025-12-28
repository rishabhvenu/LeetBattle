#!/bin/bash
# Create development secrets for local Kubernetes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load environment variables from optional env file (default: backend/.env)
ENV_FILE_DEFAULT="$SCRIPT_DIR/.env"
ENV_FILE="${ENV_FILE:-$ENV_FILE_DEFAULT}"

if [ -f "$ENV_FILE" ]; then
  echo "Loading environment variables from $ENV_FILE"
  # Export variables defined in the env file while sourcing
  set -a
  source "$ENV_FILE"
  set +a
else
  echo "Environment file $ENV_FILE not found. Continuing without it."
fi

if [ -n "${OPENAI_API_KEY:-}" ]; then
  echo "OPENAI_API_KEY=${OPENAI_API_KEY}"
else
  echo "OPENAI_API_KEY is not set"
fi

NAMESPACE="codeclashers-dev"

# Check if namespace exists, create if not
if ! kubectl get namespace "$NAMESPACE" > /dev/null 2>&1; then
  echo "Creating namespace $NAMESPACE..."
  kubectl create namespace "$NAMESPACE"
fi

# Function to extract MongoDB credentials from URI
extract_mongodb_credentials() {
    local uri="${1:-}"
    
    if [ -z "$uri" ]; then
        return 1
    fi
    
    # Extract username and password from URI
    if echo "$uri" | grep -qE '^mongodb(\+srv)?://[^@]+@'; then
        MONGODB_USERNAME=$(echo "$uri" | sed -n 's|^mongodb\(+srv\)\?://\([^:]*\):\([^@]*\)@.*|\2|p')
        MONGODB_PASSWORD=$(echo "$uri" | sed -n 's|^mongodb\(+srv\)\?://\([^:]*\):\([^@]*\)@.*|\3|p')
        
        # URL decode password in case it contains special characters
        if [ -n "$MONGODB_PASSWORD" ]; then
            MONGODB_PASSWORD=$(printf '%b\n' "${MONGODB_PASSWORD//%/\\x}")
        fi
    fi
    
    # Set defaults if extraction failed
    MONGODB_USERNAME="${MONGODB_USERNAME:-admin}"
    MONGODB_PASSWORD="${MONGODB_PASSWORD:-}"
}

# Default dev values
REDIS_PASSWORD="${REDIS_PASSWORD:-redis_dev_password_123}"

# Extract MongoDB credentials from URI if provided, otherwise use defaults
if [ -n "${MONGODB_URI:-}" ]; then
    extract_mongodb_credentials "$MONGODB_URI"
    MONGODB_USERNAME="${MONGODB_USERNAME:-admin}"
    MONGODB_PASSWORD="${MONGODB_PASSWORD:-admin123}"
else
    # Default dev values if URI not provided
    MONGODB_USERNAME="${MONGODB_USERNAME:-admin}"
    MONGODB_PASSWORD="${MONGODB_PASSWORD:-admin123}"
    # Create default URI for dev
    MONGODB_URI="${MONGODB_URI:-mongodb://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@localhost:32017/codeclashers?authSource=admin}"
fi
JUDGE0_POSTGRES_USER="${JUDGE0_POSTGRES_USER:-judge0}"
JUDGE0_POSTGRES_PASSWORD="${JUDGE0_POSTGRES_PASSWORD:-judge0_secure_pass_456}"
JUDGE0_POSTGRES_DB="${JUDGE0_POSTGRES_DB:-judge0}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin123}"
INTERNAL_SERVICE_SECRET="${INTERNAL_SERVICE_SECRET:-dev_internal_secret}"
BOT_SERVICE_SECRET="${BOT_SERVICE_SECRET:-dev_bot_secret}"
COLYSEUS_RESERVATION_SECRET="${COLYSEUS_RESERVATION_SECRET:-dev_secret}"
S3_ENDPOINT_INTERNAL="${S3_ENDPOINT_INTERNAL:-http://minio-dev:9000}"
GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-admin}"

echo "Creating development secrets in namespace $NAMESPACE..."

kubectl create secret generic app-secrets-dev \
  --namespace="$NAMESPACE" \
  --from-literal=REDIS_PASSWORD="$REDIS_PASSWORD" \
  --from-literal=REDIS_HOST="redis" \
  --from-literal=REDIS_PORT="6379" \
  --from-literal=JUDGE0_PORT="2358" \
  --from-literal=MONGODB_PORT="27017" \
  --from-literal=COLYSEUS_PORT="2567" \
  --from-literal=JUDGE0_POSTGRES_USER="$JUDGE0_POSTGRES_USER" \
  --from-literal=JUDGE0_POSTGRES_PASSWORD="$JUDGE0_POSTGRES_PASSWORD" \
  --from-literal=JUDGE0_POSTGRES_DB="$JUDGE0_POSTGRES_DB" \
  --from-literal=MONGODB_USERNAME="$MONGODB_USERNAME" \
  --from-literal=MONGODB_PASSWORD="$MONGODB_PASSWORD" \
  --from-literal=MONGODB_URI_INTERNAL="mongodb://${MONGODB_USERNAME}:${MONGODB_PASSWORD}@mongodb-dev.codeclashers-dev.svc.cluster.local:27017/codeclashers?authSource=admin" \
  --from-literal=MONGODB_URI="$MONGODB_URI" \
  --from-literal=OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
  --from-literal=INTERNAL_SERVICE_SECRET="$INTERNAL_SERVICE_SECRET" \
  --from-literal=BOT_SERVICE_SECRET="$BOT_SERVICE_SECRET" \
  --from-literal=COLYSEUS_RESERVATION_SECRET="$COLYSEUS_RESERVATION_SECRET" \
  --from-literal=AWS_ACCESS_KEY_ID="$MINIO_ROOT_USER" \
  --from-literal=AWS_SECRET_ACCESS_KEY="$MINIO_ROOT_PASSWORD" \
  --from-literal=S3_BUCKET_NAME="codeclashers-avatars" \
  --from-literal=AWS_REGION="us-east-1" \
  --from-literal=S3_ENDPOINT="$S3_ENDPOINT_INTERNAL" \
  --from-literal=MINIO_ROOT_USER="$MINIO_ROOT_USER" \
  --from-literal=MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
  --from-literal=GRAFANA_ADMIN_USER="$GRAFANA_ADMIN_USER" \
  --from-literal=GRAFANA_ADMIN_PASSWORD="$GRAFANA_ADMIN_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "✅ Development secrets created successfully!"
echo ""
echo "🌐 Access Services:"
echo ""
echo "Option 1: Via k3d loadbalancer (standard ports):"
echo "  MongoDB:    localhost:27017"
echo "  Redis:      localhost:6379"
echo "  Colyseus:   localhost:2567"
echo "  Judge0:     localhost:2358"
echo "  MinIO API:  localhost:9000"
echo "  MinIO UI:   http://localhost:9001"
echo ""
echo "Option 2: Via NodePort (if loadbalancer not configured):"
echo "  MongoDB:    localhost:32017"
echo "  Redis:      localhost:30637"
echo "  Colyseus:   localhost:30267"
echo "  Judge0:     localhost:32358"
echo "  MinIO API:  localhost:30900"
echo "  MinIO UI:   http://localhost:30901"
echo ""
echo "MinIO credentials:"
echo "  User: $MINIO_ROOT_USER"
echo "  Password: $MINIO_ROOT_PASSWORD"
echo ""
echo "Grafana credentials:"
echo "  User: $GRAFANA_ADMIN_USER"
echo "  Password: $GRAFANA_ADMIN_PASSWORD"
echo "  URL: http://localhost:3030"

