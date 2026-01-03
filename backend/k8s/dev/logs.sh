#!/bin/bash
# Real-time log viewer for CodeClashers dev services

set -e

NAMESPACE="codeclashers-dev"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

show_usage() {
  echo "Usage: $0 [service-name] [options]"
  echo ""
  echo "Services:"
  echo "  colyseus     - Colyseus game server"
  echo "  bots         - Bot service"
  echo "  judge0       - Judge0 server"
  echo "  judge0-worker - Judge0 worker"
  echo "  mongodb      - MongoDB database"
  echo "  redis        - Redis cache"
  echo "  postgres     - PostgreSQL database"
  echo "  minio        - MinIO object storage"
  echo "  prometheus   - Prometheus metrics server"
  echo "  grafana      - Grafana dashboards"
  echo "  loki         - Loki log aggregation"
  echo "  promtail     - Promtail log collector"
  echo ""
  echo "Options:"
  echo "  -f, --follow       Follow log output (default)"
  echo "  --tail=N          Show last N lines (default: 50)"
  echo "  --previous        Show logs from previous container instance"
  echo "  --all             Show logs from all pods"
  echo "  --help            Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0 colyseus              # Follow Colyseus logs"
  echo "  $0 colyseus --tail=100   # Show last 100 lines"
  echo "  $0 bots -f               # Follow bot logs"
  echo "  $0 --all                # Show all pod logs"
  exit 1
}

# Default options
FOLLOW="-f"
TAIL="50"
PREVIOUS=""
ALL_MODE=false
SERVICE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --help|-h)
      show_usage
      ;;
    -f|--follow)
      FOLLOW="-f"
      shift
      ;;
    --tail=*)
      TAIL="${1#*=}"
      FOLLOW=""  # Don't follow if tail is specified
      shift
      ;;
    --previous)
      PREVIOUS="--previous"
      shift
      ;;
    --all)
      ALL_MODE=true
      shift
      ;;
    colyseus|bots|judge0|judge0-worker|mongodb|redis|postgres|minio|prometheus|grafana|loki|promtail)
      SERVICE="$1"
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      show_usage
      ;;
  esac
done

# Service name mappings
get_service_name() {
  case $1 in
    colyseus) echo "colyseus" ;;
    bots) echo "bots" ;;
    judge0) echo "judge0-server" ;;
    judge0-worker) echo "judge0-worker" ;;
    mongodb) echo "mongodb-dev" ;;
    redis) echo "redis-cluster-dev" ;;
    postgres) echo "postgres" ;;
    minio) echo "minio-dev" ;;
    prometheus) echo "prometheus" ;;
    grafana) echo "grafana" ;;
    loki) echo "loki" ;;
    promtail) echo "promtail" ;;
    *) echo "$1" ;;
  esac
}

# Show all pod logs
show_all_logs() {
  echo -e "${BLUE}📊 Showing logs from all pods in namespace: ${NAMESPACE}${NC}"
  echo ""
  
  for pod in $(kubectl get pods -n $NAMESPACE -o jsonpath='{.items[*].metadata.name}'); do
    service_name=$(echo $pod | sed 's/-[0-9].*//')
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}📦 Pod: ${pod}${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    kubectl logs -n $NAMESPACE $pod --tail=$TAIL $PREVIOUS
    echo ""
  done
}

# Show logs for a specific service
show_service_logs() {
  local service=$(get_service_name "$SERVICE")
  
  echo -e "${BLUE}📊 Viewing logs for: ${service}${NC}"
  echo -e "${YELLOW}Press Ctrl+C to stop following logs${NC}"
  echo ""
  
  # Get pod name(s)
  local pods=$(kubectl get pods -n $NAMESPACE -l app=$service -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)
  
  if [ -z "$pods" ]; then
    # Try without label selector (direct pod name match)
    pods=$(kubectl get pods -n $NAMESPACE -o jsonpath='{.items[*].metadata.name}' | grep -E "^${service}-" || true)
  fi
  
  if [ -z "$pods" ]; then
    echo -e "${RED}❌ No pods found for service: ${service}${NC}"
    echo ""
    echo "Available pods:"
    kubectl get pods -n $NAMESPACE
    exit 1
  fi
  
  # Count pods
  local pod_count=$(echo $pods | wc -w | tr -d ' ')
  
  if [ "$pod_count" -eq 1 ]; then
    # Single pod - simple logs
    echo -e "${GREEN}📦 Pod: ${pods}${NC}"
    echo ""
    kubectl logs -n $NAMESPACE $pods --tail=$TAIL $FOLLOW $PREVIOUS
  else
    # Multiple pods - use labels to stream from all
    echo -e "${GREEN}📦 Pods: ${pods}${NC}"
    echo -e "${YELLOW}(Streaming from all ${pod_count} pods)${NC}"
    echo ""
    kubectl logs -n $NAMESPACE -l app=$service --tail=$TAIL $FOLLOW $PREVIOUS --prefix
  fi
}

# Main execution
if [ "$ALL_MODE" = true ]; then
  show_all_logs
elif [ -z "$SERVICE" ]; then
  echo -e "${RED}❌ Error: No service specified${NC}"
  echo ""
  show_usage
else
  show_service_logs
fi

