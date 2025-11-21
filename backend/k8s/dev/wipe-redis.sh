#!/bin/bash
# Completely wipe all Redis data in the dev namespace

set -euo pipefail

NAMESPACE="codeclashers-dev"
SECRET_NAME="app-secrets-dev"
APP_LABEL="redis-dev"
CONFIRM=true

usage() {
  cat <<EOF
Usage: $(basename "$0") [-y] [--namespace NAME]

Completely removes ALL data from the Redis instance running in the
development Kubernetes cluster.

Options:
  -y, --yes          Skip confirmation prompt (use with caution)
  -n, --namespace    Namespace to target (default: ${NAMESPACE})
  -h, --help         Show this help message

Example:
  ./wipe-redis.sh         # prompts before flushing
  ./wipe-redis.sh -y      # flush immediately without prompt
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      CONFIRM=false
      shift
      ;;
    -n|--namespace)
      if [[ $# -lt 2 ]]; then
        echo "❌ Missing namespace value" >&2
        exit 1
      fi
      NAMESPACE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "❌ Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

echo "⚠️  This will completely wipe ALL Redis data in namespace '${NAMESPACE}'."
echo "   Pod label selector: app=${APP_LABEL}"

if $CONFIRM; then
  read -r -p "Are you absolutely sure? Type 'wipe' to continue: " ANSWER
  if [[ "$ANSWER" != "wipe" ]]; then
    echo "❎ Aborted. Redis data left untouched."
    exit 0
  fi
fi

echo "🔐 Fetching Redis password from secret '${SECRET_NAME}'..."
PASSWORD=$(kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.REDIS_PASSWORD}' 2>/dev/null | base64 --decode)

if [[ -z "${PASSWORD}" ]]; then
  echo "❌ Could not read REDIS_PASSWORD from secret '${SECRET_NAME}' in namespace '${NAMESPACE}'." >&2
  exit 1
fi

REDIS_PODS_RAW=$(kubectl get pods -n "$NAMESPACE" -l app="$APP_LABEL" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | sed '/^$/d')
if [[ -z "$REDIS_PODS_RAW" ]]; then
  echo "❌ Unable to find Redis pods with label app=${APP_LABEL} in namespace '${NAMESPACE}'." >&2
  exit 1
fi

REDIS_PODS_COUNT=0
echo "🧹 Flushing ALL Redis data from pod(s):"
while IFS= read -r REDIS_POD; do
  [[ -z "$REDIS_POD" ]] && continue
  echo "   → FLUSHALL on $REDIS_POD"
  echo "   → FLUSHALL on $REDIS_POD"
  kubectl exec -n "$NAMESPACE" "$REDIS_POD" -- sh -c "redis-cli -a '$PASSWORD' --no-auth-warning FLUSHALL" >/tmp/redis-flush.log
  kubectl exec -n "$NAMESPACE" "$REDIS_POD" -- sh -c "redis-cli -a '$PASSWORD' --no-auth-warning SCRIPT FLUSH" >/tmp/redis-flush.log
  kubectl exec -n "$NAMESPACE" "$REDIS_POD" -- sh -c "redis-cli -a '$PASSWORD' --no-auth-warning FUNCTION FLUSH" >/tmp/redis-flush.log || true
  ((REDIS_PODS_COUNT++))
done <<< "$REDIS_PODS_RAW"

if [[ "$REDIS_PODS_COUNT" -eq 0 ]]; then
  echo "❌ No Redis pods processed. Check cluster state." >&2
  exit 1
fi

echo "✅ Redis FLUSHALL complete across $REDIS_PODS_COUNT pod(s)."

echo "🔍 Verifying DB is empty on every pod..."
overall_status=0
while IFS= read -r REDIS_POD; do
  [[ -z "$REDIS_POD" ]] && continue
  DBSIZE=$(kubectl exec -n "$NAMESPACE" "$REDIS_POD" -- sh -c "redis-cli -a '$PASSWORD' --no-auth-warning DBSIZE" | tr -d '\r')
  echo "   Pod $REDIS_POD key count: $DBSIZE"
  if [[ "$DBSIZE" != "0" ]]; then
    overall_status=1
  fi
done <<< "$REDIS_PODS_RAW"

if [[ "$overall_status" -ne 0 ]]; then
  echo "⚠️  Expected 0 keys but found remaining data. Check Redis pods for details." >&2
else
  echo "🎉 Redis database(s) are now empty."
fi

echo "📌 Tip: Redis is accessible via k3d loadbalancer on localhost:6379"
echo "       Or use port-forward: ./port-forward-daemon.sh"



