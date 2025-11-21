# Backend Debugging Playbook

Actionable checklist for diagnosing backend issues in the Kubernetes dev
environment. Follow the sequence below so automated workflows (or future you)
reproduce the same reliable reset.

## 1. Gather Signal

- Namespace: `codeclashers-dev`
- Current pods:
  ```bash
  kubectl get pods -n codeclashers-dev
  ```
- View logs with helper script:
  ```bash
  cd backend/k8s/dev
  ./logs.sh colyseus           # or bots/judge0/redis/etc.
  ./logs.sh --all --tail=200   # snapshot of everything
  ```
- For direct `kubectl`:
  ```bash
  kubectl logs -n codeclashers-dev deployment/colyseus --tail=200
  kubectl describe pod <pod> -n codeclashers-dev
  ```

## 2. Validate Port Forwards

- Check local forwards:
  ```bash
  ./check-ports.sh
  ```
- If missing, (re)start resilient forwarding:
  ```bash
  ./start-port-forward.sh
  ```

## 3. Clean State (When Matches/Queues Behave Oddly)

1. **Wipe Redis** – clears stuck reservations, bot state, matchmaking queues.
   ```bash
   ./wipe-redis.sh          # prompts; add -y to skip confirmation
   ```
2. **Safe Restart** – handles persistent volumes correctly.
   ```bash
   ./restart-safe.sh
   ```
   Use when MongoDB/Redis/Postgres need a clean restart without rebuild.

## 4. Rebuild & Redeploy Code Changes

If backend code changed or images look stale:

```bash
./rebuild.sh
```

This will:
- Build `codeclashers-colyseus:dev` and `codeclashers-bots:dev`
- Load images into kind/k3s if necessary
- Rollout restart Colyseus & Bots deployments

After rebuild, confirm pods are ready:

```bash
kubectl get pods -n codeclashers-dev
```

## 5. Post-Reset Verification

- Ensure port forwards still running (`./start-port-forward.sh` window should be open)
- Run smoke checks:
  ```bash
  curl http://localhost:2567/health        # Colyseus
  redis-cli -p 6379 ping                    # if passwordless local port-forward
  curl http://localhost:2358/               # Judge0
  ```
- Watch logs while reproducing:
  ```bash
  ./logs.sh colyseus --tail=200
  ./logs.sh bots --tail=200
  ```

## 6. Additional Tools

- `./logs.sh --previous` – inspect crashes after pod restart
- `kubectl exec -it deployment/redis-dev -n codeclashers-dev -- redis-cli ...`
- `node backend/bots/lib/queueCleanup.js` – manual bot cleanup (see
  `bot-lifecycle.md`)
- `kubectl get events -n codeclashers-dev --sort-by='.lastTimestamp'`

## When to Escalate

- Repeated CrashLoopBackOff after safe restart → inspect PVC usage, consider
  `kubectl delete pod <name> --force`
- Judge0 jobs stuck → follow `judge0-runbook.md`
- Matchmaking anomalies → see `matchmaking-flow.md`, confirm Redis keys

## Related Docs

- `deployment-runbook.md` – CI/CD and manual rollout steps
- `matchmaking-flow.md` – details on queue Redis keys and thresholds
- `bot-lifecycle.md` – bot rotation + cleanup guidance
- `judge0-runbook.md` – code execution troubleshooting


