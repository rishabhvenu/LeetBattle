#!/bin/bash
# Check port-forward status and diagnose issues

NAMESPACE="codeclashers-dev"
LOG_DIR="${TMPDIR:-/tmp}/codeclashers-port-forward"

echo "🔍 Checking port-forward status..."
echo ""

# Check if daemon is running
PID_FILE="${TMPDIR:-/tmp}/codeclashers-port-forward.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p "$PID" > /dev/null 2>&1; then
    echo "✅ Port-forward daemon is running (PID: $PID)"
  else
    echo "⚠️  Stale PID file found (process not running)"
  fi
else
  echo "⚠️  Port-forward daemon not running (no PID file)"
fi
echo ""

# Check active port-forwards
echo "📊 Active port-forward processes:"
kubectl_pforwards=$(ps aux | grep "kubectl port-forward" | grep "$NAMESPACE" | grep -v grep)
if [ -n "$kubectl_pforwards" ]; then
  echo "$kubectl_pforwards"
else
  echo "  None found"
fi
echo ""

# Check port usage
echo "🔌 Port status:"
ports=(27017 6379 2567 2358 9000 9001 3030 9090 3100)
for port in "${ports[@]}"; do
  if lsof -ti:$port >/dev/null 2>&1; then
    process=$(lsof -ti:$port | head -1)
    cmd=$(ps -p "$process" -o comm= 2>/dev/null || echo "unknown")
    echo "  Port $port: ✅ IN USE by $cmd (PID: $process)"
  else
    echo "  Port $port: ⚪ Available"
  fi
done
echo ""

# Check services
echo "📦 Service status:"
services=("mongodb-dev:27017" "redis:6379" "colyseus:2567" "judge0-server:2358" "minio-dev:9000" "grafana:3030" "prometheus:9090" "loki:3100")
for svc_port in "${services[@]}"; do
  svc="${svc_port%%:*}"
  port="${svc_port##*:}"
  if kubectl get svc "$svc" -n "$NAMESPACE" >/dev/null 2>&1; then
    echo "  ✅ $svc (port $port): Service exists"
  else
    echo "  ❌ $svc (port $port): Service not found"
  fi
done
echo ""

# Check Grafana specifically
echo "📊 Grafana details:"
if kubectl get svc grafana -n "$NAMESPACE" >/dev/null 2>&1; then
  echo "  Service type: $(kubectl get svc grafana -n "$NAMESPACE" -o jsonpath='{.spec.type}')"
  echo "  Service port: $(kubectl get svc grafana -n "$NAMESPACE" -o jsonpath='{.spec.ports[0].port}')"
  echo "  Target port: $(kubectl get svc grafana -n "$NAMESPACE" -o jsonpath='{.spec.ports[0].targetPort}')"
  if kubectl get pods -n "$NAMESPACE" -l app=grafana >/dev/null 2>&1; then
    pod_status=$(kubectl get pods -n "$NAMESPACE" -l app=grafana -o jsonpath='{.items[0].status.phase}' 2>/dev/null)
    echo "  Pod status: $pod_status"
  fi
fi
echo ""

# Check logs if daemon is running
if [ -f "$LOG_DIR/daemon.log" ]; then
  echo "📝 Recent daemon log (last 10 lines):"
  tail -10 "$LOG_DIR/daemon.log" 2>/dev/null || echo "  No log file found"
  echo ""
fi

# Recommendations
echo "💡 Recommendations:"
if lsof -ti:3030 >/dev/null 2>&1; then
  blocking_pid=$(lsof -ti:3030 | head -1)
  blocking_cmd=$(ps -p "$blocking_pid" -o comm= 2>/dev/null || echo "unknown")
  if [[ "$blocking_cmd" == *"dockerd"* ]] || [[ "$blocking_cmd" == *"com.docker"* ]]; then
    echo "  - Port 3030 is used by Docker (likely k3d loadbalancer)"
    echo "  - Grafana service is ClusterIP, so k3d loadbalancer won't forward it"
    echo "  - Options:"
    echo "    1. Use port-forward: kill $blocking_pid && ./port-forward-daemon.sh"
    echo "    2. Change Grafana service to NodePort (see monitoring/services/grafana-service.yaml)"
    echo "    3. Access via: kubectl port-forward -n $NAMESPACE svc/grafana 3030:3030"
  else
    echo "  - Port 3030 is in use by $blocking_cmd (PID: $blocking_pid)"
    echo "  - To free it: kill $blocking_pid"
  fi
fi

if ! ps aux | grep -q "[k]ubectl port-forward.*grafana"; then
  echo "  - No Grafana port-forward is running"
  echo "  - Start it: kubectl port-forward -n $NAMESPACE svc/grafana 3030:3030 &"
fi

