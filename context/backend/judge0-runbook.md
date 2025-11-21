# Judge0 Integration Runbook

Reference for diagnosing Judge0 submission issues between Colyseus and the
Judge0 server/worker deployments.

## Architecture

- Colyseus submits code through `backend/colyseus/src/lib/judge0.ts`
- Judge0 server and worker run in Kubernetes (see `backend/k8s/deployments`)
- Redis queue mediates submissions; PostgreSQL stores history
- Worker pods require privileged access; monitor resource usage closely

## Submission Flow

1. `submitToJudge0` encodes source (and optional stdin) in base64
2. Java submissions set `memory_limit = 512MB`
3. POST request to `${JUDGE0_URL}/submissions?base64_encoded=true&wait=false`
4. Colyseus stores returned `token`
5. `pollJudge0(token)` fetches results with `fields=*` and decodes stdout /
   stderr / compile output
6. Match room processes result and updates game state

## Common Failure Modes

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| `JUDGE0_URL environment variable is required` at startup | Missing secret/config | Ensure `app-secrets` includes `JUDGE0_URL` or host/port parts |
| `Judge0 submit failed: 403/500` | Auth/network issue | Check service endpoint, ingress, network policies |
| `Buffer decoding error` logs | Malformed base64 or empty response | Inspect raw result, confirm worker isn't truncating outputs |
| No result, polling hangs | Worker not running or stuck | Check `kubectl logs` for worker, verify Redis queue |
| Compilation timeout on Java | Not enough memory | Ensure worker resources + `memory_limit` applied |

## Debug Checklist

- [ ] Verify service URLs:
  ```bash
  kubectl get svc -n codeclashers-dev judge0-server
  ```
- [ ] Test API manually:
  ```bash
  curl http://localhost:2358/
  ```
- [ ] Submit sample payload:
  ```bash
  curl -X POST http://localhost:2358/submissions \
    -H "Content-Type: application/json" \
    -d '{"language_id":71,"source_code":"cHJpbnQoNDIp"}'
  ```
- [ ] Check worker logs:
  ```bash
  kubectl logs -n codeclashers-dev deployment/judge0-worker --tail=100
  ```
- [ ] Inspect Redis queue length:
  ```bash
  redis-cli llen judge0:jobs
  ```
- [ ] Confirm PostgreSQL reachable:
  ```bash
  kubectl exec -n codeclashers-dev deployment/postgres -- pg_isready
  ```

## Scaling & Recovery

- Increase worker replicas via `K8S_JUDGE0_WORKER_REPLICAS`
- Adjust CPU/memory secrets (`K8S_JUDGE0_WORKER_*`)
- For stuck jobs:
  ```bash
  kubectl delete pod -n codeclashers-dev -l app=judge0-worker
  ```
- For ARM64 limitations see `context/backend/README-JUDGE0-LIMITATION.md`

## Related Files

- `backend/colyseus/src/lib/judge0.ts`
- `backend/k8s/deployments/judge0-server.yaml`
- `backend/k8s/deployments/judge0-worker.yaml`
- `context/backend/README-PROD.md`


