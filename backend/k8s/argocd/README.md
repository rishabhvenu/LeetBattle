# ArgoCD Setup for CodeClashers

This directory contains ArgoCD and ArgoCD Image Updater manifests for GitOps-based continuous deployment.

## Quick Start

### 1. Install ArgoCD

```bash
# On the k3s cluster
cd /opt/codeclashers
sudo ./backend/k8s/argocd/install-argocd.sh
```

This will:
- Install ArgoCD core components
- Install ArgoCD Image Updater
- Expose ArgoCD UI on NodePort 30080
- Display admin credentials

### 2. Create Required Secrets

#### GHCR Registry Secret

Allows Image Updater to poll GitHub Container Registry for new images.

```bash
# Generate PAT with 'read:packages' scope at: https://github.com/settings/tokens
kubectl create secret generic ghcr-image-updater-secret \
  --from-literal=creds=<GITHUB_USERNAME>:<PAT> \
  -n argocd
```

#### Git Credentials Secret

Allows Image Updater to commit tag updates back to the repository.

```bash
# Generate PAT with 'repo' scope at: https://github.com/settings/tokens
kubectl create secret generic git-creds \
  --from-literal=username=<GITHUB_USERNAME> \
  --from-literal=password=<PAT_WITH_REPO_SCOPE> \
  -n argocd
```

#### ArgoCD Token Secret

Allows Image Updater to communicate with ArgoCD API.

```bash
# Quick method using admin account
TOKEN=$(kubectl -n argocd exec deployment/argocd-server -- \
  argocd admin token generate --username admin --id image-updater)

kubectl create secret generic argocd-image-updater-secret \
  --from-literal=argocd.token="$TOKEN" \
  -n argocd
```

### 3. Deploy Application

```bash
kubectl apply -f backend/k8s/argocd/applications/codeclashers-prod.yaml
```

### 4. Access ArgoCD UI

Open browser to: `http://<VM_IP>:30080`

- **Username**: `admin`
- **Password**: (displayed by installation script)

## Directory Structure

```
argocd/
├── install-argocd.sh                    # Installation script
├── namespace.yaml                       # ArgoCD namespace
├── install.yaml                         # ArgoCD core components (v2.13.2)
├── argocd-nodeport.yaml                 # NodePort service for UI access
├── kustomization.yaml                   # Kustomize entry point
├── applications/
│   └── codeclashers-prod.yaml          # Application definition with image update annotations
└── image-updater/
    ├── install.yaml                     # Image Updater deployment
    ├── ghcr-registry-secret.yaml.template  # GHCR credentials template
    ├── git-creds-secret.yaml.template      # Git credentials template
    └── argocd-token-secret.yaml.template   # ArgoCD token template
```

## How It Works

1. **Code Push**: Developer pushes code to `main` branch
2. **CI Build**: GitHub Actions builds Docker images with commit SHA tags
3. **Image Push**: Images pushed to GHCR with `:latest` and `:<commit-sha>` tags
4. **Image Detection**: Image Updater polls GHCR, detects new `:latest` digest
5. **Git Update**: Image Updater commits new SHA tag to `kustomization.yaml`
6. **ArgoCD Sync**: ArgoCD detects Git change and syncs to cluster
7. **Rolling Update**: New version deployed with zero downtime

## Key Features

- ✅ **Automated Deployments**: New images trigger automatic updates
- ✅ **GitOps Workflow**: All changes tracked in Git
- ✅ **Zero Downtime**: Rolling updates with health checks
- ✅ **Easy Rollback**: Revert via Git or ArgoCD UI
- ✅ **Self-Healing**: Auto-corrects configuration drift

## Image Update Configuration

Image Updater tracks these images:

| Image | Registry | Strategy |
|-------|----------|----------|
| `codeclashers-colyseus` | GHCR | Track `:latest` by digest |
| `codeclashers-bots` | GHCR | Track `:latest` by digest |
| `codeclashers-judge0-api-arm64` | GHCR | Track `:latest` by digest |
| `codeclashers-judge0-worker-arm64` | GHCR | Track `:latest` by digest |

**Tag Pattern**: Only commit SHA tags (7-char hex) are allowed: `^[a-f0-9]{7}$`

## Monitoring

### Check Application Status

```bash
kubectl get application -n argocd
kubectl describe application codeclashers-prod -n argocd
```

### View Image Updater Logs

```bash
kubectl logs -n argocd deployment/argocd-image-updater -f
```

### Check ArgoCD Logs

```bash
kubectl logs -n argocd deployment/argocd-server -f
```

## Troubleshooting

### Application Not Syncing

```bash
# Force sync
kubectl patch application codeclashers-prod -n argocd \
  --type merge -p '{"operation":{"sync":{"syncStrategy":{"hook":{}}},"initiatedBy":{"username":"admin"}}}'
```

### Image Updater Not Working

```bash
# Check secrets exist
kubectl get secret ghcr-image-updater-secret -n argocd
kubectl get secret git-creds -n argocd
kubectl get secret argocd-image-updater-secret -n argocd

# View Image Updater logs
kubectl logs -n argocd deployment/argocd-image-updater --tail=100
```

### Reset Admin Password

```bash
# Delete secret to regenerate
kubectl delete secret argocd-initial-admin-secret -n argocd
kubectl rollout restart deployment argocd-server -n argocd
# Wait 1 minute, then retrieve new password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
```

## Documentation

For complete documentation, see: [`context/backend/argocd.md`](../../../context/backend/argocd.md)

## Uninstall

```bash
# Delete application (will remove all deployed resources)
kubectl delete application codeclashers-prod -n argocd

# Delete ArgoCD
kubectl delete namespace argocd
```

## References

- [ArgoCD Documentation](https://argo-cd.readthedocs.io/)
- [ArgoCD Image Updater](https://argocd-image-updater.readthedocs.io/)
- [Kustomize](https://kubectl.docs.kubernetes.io/references/kustomize/)

