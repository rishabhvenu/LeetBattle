    #!/bin/bash
# Quick connectivity diagnostic script
# Tests all connections in the Kubernetes dev environment

set -e

NAMESPACE="codeclashers-dev"
PASS=0
FAIL=0

echo "🔍 CodeClashers Connectivity Diagnostic"
echo "========================================"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test function
test_connection() {
    local name=$1
    local test_cmd=$2
    local invert=$3
    
    echo -n "Testing $name... "
    
    if eval "$test_cmd" > /dev/null 2>&1; then
        if [ "$invert" = "true" ]; then
            echo -e "${RED}FAIL${NC}"
            FAIL=$((FAIL + 1))
            return 1
        else
            echo -e "${GREEN}✓ PASS${NC}"
            PASS=$((PASS + 1))
            return 0
        fi
    else
        if [ "$invert" = "true" ]; then
            echo -e "${GREEN}✓ PASS${NC}"
            PASS=$((PASS + 1))
            return 0
        else
            echo -e "${RED}✗ FAIL${NC}"
            FAIL=$((FAIL + 1))
            return 1
        fi
    fi
}

# 1. Check Kubernetes connection
echo "📡 Kubernetes Cluster"
test_connection "Kubernetes cluster" "kubectl cluster-info" || exit 1
echo ""

# 2. Check namespace
echo "📦 Namespace"
test_connection "Namespace exists" "kubectl get namespace $NAMESPACE" || {
    echo "  Run: kubectl create namespace $NAMESPACE"
    exit 1
}
echo ""

# 3. Check pods
echo "🐳 Pods Status"
pods=$(kubectl get pods -n $NAMESPACE -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [ -z "$pods" ]; then
    echo -e "${RED}✗ No pods found${NC}"
    echo "  Run: ./setup-dev.sh"
    exit 1
fi

for pod in $pods; do
    status=$(kubectl get pod $pod -n $NAMESPACE -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
    ready=$(kubectl get pod $pod -n $NAMESPACE -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || echo "false")
    
    if [ "$status" = "Running" ] && [ "$ready" = "true" ]; then
        echo -e "  ${GREEN}✓${NC} $pod: $status"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $pod: $status (ready: $ready)"
        FAIL=$((FAIL + 1))
    fi
done
echo ""

# 4. Check services
echo "🌐 Services"
services=$(kubectl get svc -n $NAMESPACE -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
if [ -z "$services" ]; then
    echo -e "${RED}✗ No services found${NC}"
    FAIL=$((FAIL + 1))
else
    for svc in $services; do
        endpoints=$(kubectl get endpoints $svc -n $NAMESPACE -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || echo "")
        if [ -n "$endpoints" ]; then
            echo -e "  ${GREEN}✓${NC} $svc (has endpoints)"
            PASS=$((PASS + 1))
        else
            echo -e "  ${YELLOW}⚠${NC} $svc (no endpoints)"
        fi
    done
fi
echo ""

# 5. Check port-forwarding
echo "🔌 Port Forwarding"
test_connection "MongoDB port-forward (27017)" "lsof -i :27017 | grep kubectl" || echo "  ⚠️  Port-forward not active: ./port-forward.sh"
test_connection "Redis port-forward (6379)" "lsof -i :6379 | grep kubectl" || echo "  ⚠️  Port-forward not active: ./port-forward.sh"
test_connection "Colyseus port-forward (2567)" "lsof -i :2567 | grep kubectl" || echo "  ⚠️  Port-forward not active: ./port-forward.sh"
test_connection "Judge0 port-forward (2358)" "lsof -i :2358 | grep kubectl" || echo "  ⚠️  Port-forward not active: ./port-forward.sh"
echo ""

# 6. Test internal DNS
echo "🔍 Internal DNS Resolution"
if kubectl run -it --rm connectivity-test-dns --image=busybox --restart=Never -n $NAMESPACE -- \
    sh -c "nslookup redis.codeclashers-dev.svc.cluster.local > /dev/null 2>&1 && \
           nslookup mongodb-dev.codeclashers-dev.svc.cluster.local > /dev/null 2>&1 && \
           nslookup judge0-server.codeclashers-dev.svc.cluster.local > /dev/null 2>&1" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} DNS resolution working"
    PASS=$((PASS + 1))
else
    echo -e "  ${RED}✗${NC} DNS resolution failed"
    FAIL=$((FAIL + 1))
fi
kubectl delete pod connectivity-test-dns -n $NAMESPACE --ignore-not-found=true > /dev/null 2>&1
echo ""

# 7. Test Colyseus connections
echo "🎮 Colyseus Internal Connections"
if kubectl get deployment colyseus -n $NAMESPACE > /dev/null 2>&1; then
    # Test MongoDB connection string
    mongodb_uri=$(kubectl exec -n $NAMESPACE deployment/colyseus -- env 2>/dev/null | grep MONGODB_URI | cut -d'=' -f2 || echo "")
    if echo "$mongodb_uri" | grep -q "mongodb-dev.codeclashers-dev.svc.cluster.local"; then
        echo -e "  ${GREEN}✓${NC} MongoDB URI uses internal DNS"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} MongoDB URI incorrect: $mongodb_uri"
        FAIL=$((FAIL + 1))
    fi
    
    # Test Redis host
    redis_host=$(kubectl exec -n $NAMESPACE deployment/colyseus -- env 2>/dev/null | grep "^REDIS_HOST=" | cut -d'=' -f2 || echo "")
    if [ "$redis_host" = "redis" ] || echo "$redis_host" | grep -q "redis.codeclashers-dev.svc.cluster.local"; then
        echo -e "  ${GREEN}✓${NC} Redis host correct: $redis_host"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} Redis host incorrect: $redis_host"
        FAIL=$((FAIL + 1))
    fi
    
    # Test Judge0 connection
    if kubectl exec -n $NAMESPACE deployment/colyseus -- wget -O- http://judge0-server:2358/ 2>&1 | grep -q "judge0\|API\|version"; then
        echo -e "  ${GREEN}✓${NC} Can reach Judge0"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} Cannot reach Judge0"
        FAIL=$((FAIL + 1))
    fi
else
    echo -e "  ${YELLOW}⚠${NC} Colyseus deployment not found"
fi
echo ""

# 8. Test external access
echo "🌍 External Access (localhost)"
test_connection "Colyseus HTTP (localhost:2567)" "curl -s http://localhost:2567/ > /dev/null" || echo "  ⚠️  Start port-forwarding: ./port-forward.sh"
test_connection "Judge0 HTTP (localhost:2358)" "curl -s http://localhost:2358/ > /dev/null" || echo "  ⚠️  Start port-forwarding: ./port-forward.sh"
echo ""

# 9. Check secrets
echo "🔐 Secrets"
if kubectl get secret app-secrets-dev -n $NAMESPACE > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} app-secrets-dev exists"
    PASS=$((PASS + 1))
    
    # Check critical secrets
    required_keys=("MONGODB_URI_INTERNAL" "REDIS_PASSWORD" "JUDGE0_PORT")
    for key in "${required_keys[@]}"; do
        if kubectl get secret app-secrets-dev -n $NAMESPACE -o jsonpath="{.data.$key}" > /dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} Secret key exists: $key"
            PASS=$((PASS + 1))
        else
            echo -e "  ${RED}✗${NC} Missing secret key: $key"
            FAIL=$((FAIL + 1))
        fi
    done
else
    echo -e "  ${RED}✗${NC} app-secrets-dev not found"
    echo "  Run: ./create-dev-secrets.sh"
    FAIL=$((FAIL + 1))
fi
echo ""

# Summary
echo "========================================"
echo "📊 Summary"
echo -e "  ${GREEN}Passed: $PASS${NC}"
if [ $FAIL -gt 0 ]; then
    echo -e "  ${RED}Failed: $FAIL${NC}"
    echo ""
    echo "💡 Tips:"
    echo "  - If port-forwarding fails, run: ./port-forward.sh"
    echo "  - If services aren't ready, wait or check: kubectl get pods -n $NAMESPACE"
    echo "  - If secrets are missing, run: ./create-dev-secrets.sh"
    echo "  - For detailed troubleshooting, see: CONNECTIVITY.md"
    exit 1
else
    echo -e "  ${GREEN}All checks passed!${NC}"
    exit 0
fi

















