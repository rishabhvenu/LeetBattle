#!/bin/bash
# Start port-forwarding for all services and keep them alive even after pod restarts

set -euo pipefail

NAMESPACE="codeclashers-dev"
LOG_DIR="${TMPDIR:-/tmp}/codeclashers-port-forward"
mkdir -p "$LOG_DIR"

FORWARD_PIDS=()

cleanup() {
  echo ""
  echo "🛑 Stopping port forwards..."
  for pid in "${FORWARD_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  exit 0
}

trap cleanup INT TERM

echo "🔌 Starting resilient port forwarding for services in namespace '$NAMESPACE'"
echo "(press Ctrl+C to stop)"
echo ""

start_port_forward() {
  local service=$1
  local local_port=$2
  local target_port=$3

  if lsof -ti:$local_port >/dev/null 2>&1; then
    local blocking_process=$(lsof -ti:$local_port | head -1)
    local blocking_cmd=$(ps -p "$blocking_process" -o comm= 2>/dev/null || echo "unknown")
    echo "⚠️  Port $local_port already in use by $blocking_cmd (PID: $blocking_process), skipping $service"
    if [[ "$blocking_cmd" == *"dockerd"* ]] || [[ "$blocking_cmd" == *"com.docker"* ]]; then
      echo "   💡 This is likely k3d loadbalancer. For ClusterIP services like Grafana,"
      echo "      you need port-forwarding. Kill the process and restart: kill $blocking_process"
    fi
    return
  fi

  (
    while true; do
      timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
      echo "[$timestamp] 🔁 Starting port-forward for $service on localhost:$local_port"
      kubectl port-forward -n "$NAMESPACE" "svc/$service" "$local_port:$target_port" \
        &>"$LOG_DIR/$service.log"
      exit_code=$?
      timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
      echo "[$timestamp] ⚠️  Port-forward for $service exited (code $exit_code). Restarting in 2 seconds..."
      sleep 2
    done
  ) &

  FORWARD_PIDS+=($!)
}

start_port_forward "mongodb-dev" 27017 27017
# Use 6380 for Redis since local Redis may be on 6379
# If local Redis is stopped, change this back to 6379:6379
start_port_forward "redis-cluster-dev" 6380 6379
start_port_forward "colyseus" 2567 2567
start_port_forward "judge0-server" 2358 2358
start_port_forward "minio-dev" 9000 9000
start_port_forward "minio-dev" 9001 9001
start_port_forward "grafana" 3030 3030
start_port_forward "prometheus" 9090 9090
start_port_forward "loki" 3100 3100

echo ""
echo "✅ Port-forward supervision started. Logs: $LOG_DIR/<service>.log"
echo "   This window must stay open; forwards restart automatically if pods restart."
echo ""

wait

