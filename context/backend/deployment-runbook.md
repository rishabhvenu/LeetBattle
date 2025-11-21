# Backend Deployment Runbook

Use this when operating the backend GitHub Actions pipelines or performing a
manual deployment to k3s.

## Pipelines

- Workflow: `.github/workflows/deploy-backend.yml`
- Trigger: push to `main` touching `backend/**` or manual dispatch
- Runner: self-hosted Oracle VM with k3s installed

### Pipeline Stages

1. **Checkout & Setup**
   - `actions/checkout`
   - Configure Node.js (18.x) and Docker
2. **Install Dependencies**
   - Runs `npm ci` inside `backend/colyseus` and `backend/bots`
   - Caches `~/.npm` between runs
3. **Lint & Build**
   - `npm run lint` for Colyseus and Bots
   - `npm run build` to compile TypeScript
4. **Docker Build & Push**
   - Logs in to GHCR (`ghcr.io`)
   - Builds `codeclashers-colyseus` and `codeclashers-bots`
   - Tags images with commit SHA, pushes to registry
5. **Kubernetes Deploy**
   - Uses `kubectl` against local k3s
   - Applies secrets/configmaps via `kubectl apply -k backend/k8s`
   - Performs rolling updates for deployments
6. **Health Checks**
   - Waits for rollout status on Colyseus, Bots, Judge0 components
   - Fails pipeline if readiness probes fail

## Manual Deployment Steps

1. SSH into runner VM
2. Pull latest code and set `KUBECONFIG`
   ```bash
   cd /opt/codeclashers
   git pull
   export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
   ```
3. Build images (if GHCR unavailable)
   ```bash
   docker build -t codeclashers-colyseus:manual backend/colyseus
   docker build -t codeclashers-bots:manual backend/bots
   ```
4. Update deployments
   ```bash
   kubectl set image deployment/colyseus colyseus=codeclashers-colyseus:manual -n codeclashers
   kubectl set image deployment/bots bots=codeclashers-bots:manual -n codeclashers
   ```
5. Monitor rollout
   ```bash
   kubectl rollout status deployment/colyseus -n codeclashers
   kubectl rollout status deployment/bots -n codeclashers
   ```

## Secrets & Config

- Stored as GitHub Secrets consumed by workflow
- Critical keys:
  - `REDIS_PASSWORD`
  - `MONGODB_URI`
  - `OPENAI_API_KEY`
  - `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
  - `INTERNAL_SERVICE_SECRET`, `BOT_SERVICE_SECRET`
- Config maps supply hostnames (`app-config.yaml`) and ports

## Monitoring After Deploy

- Check pods:
  ```bash
  kubectl get pods -n codeclashers
  ```
- Tail logs:
  ```bash
  kubectl logs -n codeclashers deployment/colyseus -f
  ```
- Validate endpoints (from runner):
  ```bash
  curl http://colyseus.codeclashers.svc.cluster.local:2567/health
  ```

## Rollback

- Previous ReplicaSet retained by Kubernetes; run:
  ```bash
  kubectl rollout undo deployment/colyseus -n codeclashers
  kubectl rollout undo deployment/bots -n codeclashers
  ```
- For registry issues, set image back to prior tag explicitly.

## Related Docs

- `context/backend/overview.md`
- `backend/k8s/README.md` (local dev)
- `context/backend/README-PROD.md`
- `.github/workflows/deploy-backend.yml`


