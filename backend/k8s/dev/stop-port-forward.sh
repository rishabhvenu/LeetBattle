#!/bin/bash
# Stop the port-forward daemon

PID_FILE="${TMPDIR:-/tmp}/codeclashers-port-forward.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "⚠️  Port-forward daemon is not running (no PID file found)"
  exit 0
fi

PID=$(cat "$PID_FILE")

if ! ps -p "$PID" > /dev/null 2>&1; then
  echo "⚠️  Port-forward daemon process not found (stale PID file)"
  rm -f "$PID_FILE"
  exit 0
fi

echo "🛑 Stopping port-forward daemon (PID: $PID)..."
kill "$PID" 2>/dev/null || true

# Also kill any remaining kubectl port-forward processes
pkill -f "kubectl port-forward.*codeclashers-dev" 2>/dev/null || true

rm -f "$PID_FILE"
echo "✅ Port-forward daemon stopped"

