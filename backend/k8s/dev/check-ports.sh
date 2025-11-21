#!/bin/bash
# Check if all required ports are being forwarded

echo "🔍 Checking port-forward status..."
echo ""

check_port() {
  local port=$1
  local service=$2
  
  if lsof -ti:$port > /dev/null 2>&1; then
    echo "✅ Port $port ($service) - Active"
    return 0
  else
    echo "❌ Port $port ($service) - NOT forwarded"
    return 1
  fi
}

PORTS_OK=true

check_port 27017 "MongoDB" || PORTS_OK=false
check_port 6380 "Redis (Kubernetes)" || PORTS_OK=false
check_port 2567 "Colyseus" || PORTS_OK=false
check_port 2358 "Judge0" || PORTS_OK=false
check_port 9000 "MinIO API" || PORTS_OK=false
check_port 9001 "MinIO Console" || PORTS_OK=false

echo ""

if [ "$PORTS_OK" = true ]; then
  echo "✅ All ports are forwarded correctly!"
  exit 0
else
  echo "⚠️  Some ports are not forwarded. Run:"
  echo "   cd backend/k8s/dev && ./start-port-forward.sh"
  exit 1
fi










