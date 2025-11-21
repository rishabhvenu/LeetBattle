#!/bin/bash
# Background daemon for port forwarding that auto-restarts and persists across terminal sessions
# This script runs port forwards in the background and keeps them alive

set -euo pipefail

NAMESPACE="codeclashers-dev"
PID_FILE="${TMPDIR:-/tmp}/codeclashers-port-forward.pid"
LOG_DIR="${TMPDIR:-/tmp}/codeclashers-port-forward"
mkdir -p "$LOG_DIR"

# Check if already running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if ps -p "$OLD_PID" > /dev/null 2>&1; then
    echo "⚠️  Port-forward daemon is already running (PID: $OLD_PID)"
    echo "   To stop it: kill $OLD_PID"
    echo "   Or: ./stop-port-forward.sh"
    exit 0
  else
    # Stale PID file
    rm -f "$PID_FILE"
  fi
fi

start_port_forward() {
  local service=$1
  local local_port=$2
  local target_port=$3

  if lsof -ti:$local_port >/dev/null 2>&1; then
    local blocking_process=$(lsof -ti:$local_port | head -1)
    local blocking_cmd=$(ps -p "$blocking_process" -o comm= 2>/dev/null || echo "unknown")
    echo "⚠️  Port $local_port already in use by $blocking_cmd (PID: $blocking_process), skipping $service" | tee -a "$LOG_DIR/daemon.log"
    echo "   💡 Tip: If this is k3d loadbalancer, you can access the service directly"
    echo "   💡 Or kill the process and restart port-forward: kill $blocking_process"
    return
  fi

  (
    while true; do
      # Wait for service to be available
      until kubectl get svc -n "$NAMESPACE" "$service" >/dev/null 2>&1; do
        sleep 2
      done
      
      timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
      echo "[$timestamp] 🔁 Starting port-forward for $service on localhost:$local_port" >> "$LOG_DIR/daemon.log"
      kubectl port-forward -n "$NAMESPACE" "svc/$service" "$local_port:$target_port" \
        >> "$LOG_DIR/$service.log" 2>&1
      exit_code=$?
      timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
      echo "[$timestamp] ⚠️  Port-forward for $service exited (code $exit_code). Restarting in 2 seconds..." >> "$LOG_DIR/daemon.log"
      sleep 2
    done
  ) &
}

echo "🚀 Starting port-forward daemon..."
echo "   Logs: $LOG_DIR/"
echo "   PID file: $PID_FILE"
echo ""

# Start all port forwards
start_port_forward "mongodb-dev" 27017 27017
# Use 6380 for Redis since local Redis or k3d loadbalancer may be on 6379
start_port_forward "redis" 6380 6379
start_port_forward "colyseus" 2567 2567
start_port_forward "judge0-server" 2358 2358
start_port_forward "minio-dev" 9000 9000
start_port_forward "minio-dev" 9001 9001
start_port_forward "grafana" 3030 3030
start_port_forward "prometheus" 9090 9090
start_port_forward "loki" 3100 3100

# Save the main process group PID
echo $$ > "$PID_FILE"

echo "✅ Port-forward daemon started!"
echo "   Services accessible on:"
echo "     MongoDB:    localhost:27017"
echo "     Redis:      localhost:6380 (6379 may be in use by k3d loadbalancer)"
echo "     Colyseus:   localhost:2567"
echo "     Judge0:     localhost:2358"
echo "     MinIO API:  localhost:9000"
echo "     MinIO UI:   localhost:9001"
echo "     Grafana:    localhost:3030"
echo "     Prometheus: localhost:9090"
echo "     Loki:       localhost:3100"
echo ""
echo "   To stop: ./stop-port-forward.sh or kill \$(cat $PID_FILE)"
echo "   To view logs: tail -f $LOG_DIR/daemon.log"
echo ""

# Keep script running and monitor child processes
trap "echo '🛑 Stopping port-forward daemon...'; pkill -P $$; rm -f $PID_FILE; exit 0" INT TERM

# Wait for all background jobs
wait

