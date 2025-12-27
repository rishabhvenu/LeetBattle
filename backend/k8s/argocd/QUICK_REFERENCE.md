# ArgoCD Quick Reference Card

## Access

**UI**: `http://<VM_IP>:30080`  
**Username**: `admin`  
**Get Password**: `kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d`

## Installation

```bash
# Install ArgoCD
cd /opt/codeclashers
sudo ./backend/k8s/argocd/install-argocd.sh

# Create GHCR secret (read:packages PAT)
kubectl create secret generic ghcr-image-updater-secret \
  --from-literal=creds=USERNAME:PAT -n argocd

# Create Git secret (repo PAT)
kubectl create secret generic git-creds \
  --from-literal=username=USERNAME \
  --from-literal=password=PAT -n argocd

# Create ArgoCD token
TOKEN=$(kubectl -n argocd exec deployment/argocd-server -- \
  argocd admin token generate --username admin --id image-updater)
kubectl create secret generic argocd-image-updater-secret \
  --from-literal=argocd.token="$TOKEN" -n argocd

# Deploy application
kubectl apply -f backend/k8s/argocd/applications/codeclashers-prod.yaml
```

## Common Commands

### Application Management
```bash
# List applications
kubectl get application -n argocd

# Get application details
kubectl describe application codeclashers-prod -n argocd

# Force sync
kubectl patch application codeclashers-prod -n argocd \
  --type merge -p '{"metadata":{"annotations":{"argocd.argoproj.io/sync-wave":"0"}}}'

# Delete application (removes all resources!)
kubectl delete application codeclashers-prod -n argocd
```

### Monitoring
```bash
# Watch application status
kubectl get application -n argocd -w

# View Image Updater logs
kubectl logs -n argocd deployment/argocd-image-updater -f --tail=50

# View ArgoCD server logs
kubectl logs -n argocd deployment/argocd-server -f --tail=50

# Check deployed resources
kubectl get all -n codeclashers
```

### Image Updater
```bash
# Check last update time
kubectl get application codeclashers-prod -n argocd \
  -o jsonpath='{.metadata.annotations.argocd-image-updater\.argoproj\.io/last-update-time}'

# View current image versions
kubectl get application codeclashers-prod -n argocd \
  -o jsonpath='{.metadata.annotations.argocd-image-updater\.argoproj\.io/image-list}'

# Force image check (restart Image Updater)
kubectl rollout restart deployment/argocd-image-updater -n argocd
```

### Rollback
```bash
# Via Git (recommended)
cd /opt/codeclashers
git log backend/k8s/overlays/prod/kustomization.yaml
git revert <commit-sha>
git push
# ArgoCD will auto-sync the rollback

# Via ArgoCD UI
# Go to: Applications > codeclashers-prod > History and Rollback
# Select revision > Click "Rollback"
```

### Troubleshooting
```bash
# Check sync status
kubectl get application codeclashers-prod -n argocd \
  -o jsonpath='{.status.sync.status}'

# View sync errors
kubectl get application codeclashers-prod -n argocd -o yaml | grep -A 10 status

# Check if secrets exist
kubectl get secret -n argocd | grep -E "ghcr|git-creds|argocd-image-updater"

# Restart ArgoCD components
kubectl rollout restart deployment/argocd-server -n argocd
kubectl rollout restart deployment/argocd-repo-server -n argocd
kubectl rollout restart statefulset/argocd-application-controller -n argocd

# Reset admin password
kubectl delete secret argocd-initial-admin-secret -n argocd
kubectl rollout restart deployment argocd-server -n argocd
# Wait 1 minute, then get new password
```

## Deployment Flow

1. Push code to `main` → 2. GitHub Actions builds images → 3. Push to GHCR → 4. Image Updater detects → 5. Commits to Git → 6. ArgoCD syncs → 7. Rolling update

**Total Time**: 10-15 minutes from push to production

## Health Checks

```bash
# All pods should be Running
kubectl get pods -n argocd
kubectl get pods -n codeclashers

# Application should be Healthy and Synced
kubectl get application -n argocd

# Image Updater should show recent updates
kubectl logs -n argocd deployment/argocd-image-updater --tail=20
```

## Documentation

- **Full Guide**: `context/backend/argocd.md`
- **Quick Start**: `backend/k8s/argocd/README.md`
- **Summary**: `ARGOCD_IMPLEMENTATION_SUMMARY.md`

## Emergency Procedures

### Rollback Last Deployment
```bash
cd /opt/codeclashers
git revert HEAD
git push
```

### Disable Auto-Sync
```bash
kubectl patch application codeclashers-prod -n argocd \
  --type merge -p '{"spec":{"syncPolicy":{"automated":null}}}'
```

### Manual Deployment (bypass ArgoCD)
```bash
kubectl apply -k backend/k8s/overlays/prod/
```

### Uninstall ArgoCD
```bash
kubectl delete application codeclashers-prod -n argocd  # Removes app
kubectl delete namespace argocd  # Removes ArgoCD
```

