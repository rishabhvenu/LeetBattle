#!/bin/bash
# ArgoCD Installation and Setup Script
# This script installs ArgoCD and ArgoCD Image Updater on k3s cluster

set -e

echo "=================================================="
echo "ArgoCD Installation Script for CodeClashers"
echo "=================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running on the cluster
if ! command -v kubectl &> /dev/null; then
    echo -e "${RED}Error: kubectl not found${NC}"
    echo "This script must be run on the k3s cluster"
    exit 1
fi

echo -e "${GREEN}Step 1: Installing ArgoCD${NC}"
kubectl apply -k backend/k8s/argocd/

echo ""
echo "Waiting for ArgoCD pods to be ready (this may take 2-3 minutes)..."
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=argocd-server -n argocd --timeout=300s
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=argocd-application-controller -n argocd --timeout=300s
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=argocd-repo-server -n argocd --timeout=300s

echo ""
echo -e "${GREEN}✓ ArgoCD installed successfully!${NC}"
echo ""

# Get admin password
echo -e "${GREEN}Step 2: Retrieving ArgoCD Admin Password${NC}"
ADMIN_PASSWORD=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d)

echo ""
echo "=================================================="
echo -e "${GREEN}ArgoCD Installation Complete!${NC}"
echo "=================================================="
echo ""
echo "Access the ArgoCD UI at:"
echo -e "  ${YELLOW}http://$(hostname -I | awk '{print $1}'):30080${NC}"
echo ""
echo "Login credentials:"
echo -e "  Username: ${YELLOW}admin${NC}"
echo -e "  Password: ${YELLOW}${ADMIN_PASSWORD}${NC}"
echo ""
echo "=================================================="
echo ""

echo -e "${YELLOW}Next Steps:${NC}"
echo ""
echo "1. Create GHCR Registry Secret (for Image Updater to read images):"
echo "   kubectl create secret generic ghcr-image-updater-secret \\"
echo "     --from-literal=creds=GITHUB_USERNAME:GITHUB_PAT \\"
echo "     -n argocd"
echo ""
echo "2. Create Git Credentials Secret (for Image Updater to commit):"
echo "   kubectl create secret generic git-creds \\"
echo "     --from-literal=username=GITHUB_USERNAME \\"
echo "     --from-literal=password=GITHUB_PAT_WITH_REPO_SCOPE \\"
echo "     -n argocd"
echo ""
echo "3. Create ArgoCD Token Secret (for Image Updater API access):"
echo "   # Quick method using admin account:"
echo "   TOKEN=\$(kubectl -n argocd exec deployment/argocd-server -- \\"
echo "     argocd admin token generate --username admin --id image-updater)"
echo "   kubectl create secret generic argocd-image-updater-secret \\"
echo "     --from-literal=argocd.token=\"\$TOKEN\" \\"
echo "     -n argocd"
echo ""
echo "4. Deploy the CodeClashers application:"
echo "   kubectl apply -f backend/k8s/argocd/applications/codeclashers-prod.yaml"
echo ""
echo "5. Monitor the deployment:"
echo "   kubectl get application -n argocd -w"
echo ""
echo "For detailed instructions, see: context/backend/argocd.md"
echo ""

