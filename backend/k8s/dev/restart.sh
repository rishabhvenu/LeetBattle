#!/bin/bash
# Restart all CodeClashers dev services

set -e

NAMESPACE="codeclashers-dev"

echo "🔄 Restarting all services in namespace: $NAMESPACE"
echo ""

# Desired restart order (each entry is colon-separated: type:name)
ORDER=(
  "deployment:redis-dev"
  "deployment:mongodb-dev"
  "deployment:judge0-server"
  "deployment:colyseus"
  "deployment:bots"
)

echo "📦 Restart order:"
for item in "${ORDER[@]}"; do
  echo "  - ${item}"
done
echo ""

# Collect remaining deployments/daemonsets so we can restart everything else afterwards
ALL_DEPLOYMENTS=( $(kubectl get deployments -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}') )
ALL_DAEMONSETS=( $(kubectl get daemonsets -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "") )

declare -a REMAINING_DEPLOYMENTS=()
declare -a REMAINING_DAEMONSETS=()

for dep in "${ALL_DEPLOYMENTS[@]}"; do
  skip=false
  for item in "${ORDER[@]}"; do
    type=${item%%:*}
    name=${item##*:}
    if [[ $type == "deployment" && $name == "$dep" ]]; then
      skip=true
      break
    fi
  done
  $skip || REMAINING_DEPLOYMENTS+=("$dep")
done

for ds in "${ALL_DAEMONSETS[@]}"; do
  skip=false
  for item in "${ORDER[@]}"; do
    type=${item%%:*}
    name=${item##*:}
    if [[ $type == "daemonset" && $name == "$ds" ]]; then
      skip=true
      break
    fi
  done
  $skip || REMAINING_DAEMONSETS+=("$ds")
done

restart_resource() {
  local type=$1
  local name=$2
  echo "🔄 Restarting ${type}/${name}..."
  kubectl rollout restart "${type}/${name}" -n "$NAMESPACE"

  if [[ ${type} == "deployment" && ${name} == "mongodb-dev" ]]; then
    echo "  ⚠️  MongoDB uses ReadWriteOnce volume - waiting for old pod to terminate..."
    sleep 3
    kubectl get pods -n "$NAMESPACE" -l app=mongodb-dev -o jsonpath='{.items[?(@.status.containerStatuses[0].state.waiting.reason=="CrashLoopBackOff")].metadata.name}' \
      | xargs -r kubectl delete pod -n "$NAMESPACE" 2>/dev/null || true
  fi
}

wait_for_resource() {
  local type=$1
  local name=$2
  echo "  Waiting for ${type}/${name}..."
  kubectl rollout status "${type}/${name}" -n "$NAMESPACE" --timeout=180s || echo "    ⚠️  ${type}/${name} may still be restarting"
}

echo "🚀 Restarting critical services in required order..."
for item in "${ORDER[@]}"; do
  type=${item%%:*}
  name=${item##*:}

  # verify existence
  if [[ $type == "deployment" ]]; then
    if ! kubectl get deployment "$name" -n "$NAMESPACE" >/dev/null 2>&1; then
      echo "  ⚠️  Deployment $name not found, skipping"
      continue
    fi
  elif [[ $type == "daemonset" ]]; then
    if ! kubectl get daemonset "$name" -n "$NAMESPACE" >/dev/null 2>&1; then
      echo "  ⚠️  DaemonSet $name not found, skipping"
      continue
    fi
  fi

  restart_resource "$type" "$name"
done

echo ""
echo "🔄 Restarting remaining deployments..."
for dep in "${REMAINING_DEPLOYMENTS[@]}"; do
  restart_resource "deployment" "$dep"
done

if [[ ${#REMAINING_DAEMONSETS[@]} -gt 0 ]]; then
  echo ""
  echo "🔄 Restarting remaining daemonsets..."
  for ds in "${REMAINING_DAEMONSETS[@]}"; do
    restart_resource "daemonset" "$ds"
  done
fi

echo ""
echo "⏳ Waiting for restarts to complete..."
echo ""

for item in "${ORDER[@]}"; do
  type=${item%%:*}
  name=${item##*:}
  wait_for_resource "$type" "$name"
done

for dep in "${REMAINING_DEPLOYMENTS[@]}"; do
  wait_for_resource "deployment" "$dep"
done

for ds in "${REMAINING_DAEMONSETS[@]}"; do
  wait_for_resource "daemonset" "$ds"
done

echo ""
echo "✅ All services restarted!"
echo ""
echo "📊 Current status:"
kubectl get pods -n $NAMESPACE

