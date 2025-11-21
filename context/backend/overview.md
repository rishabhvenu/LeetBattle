# Backend Context Overview

This directory gives backend-oriented reference material that used to live
across `backend/` and the repository root. Use this index to find the right
document quickly.

## Platform Operations
- `k8s/dev/QUICKSTART.md` — One-stop setup guide for Docker Desktop
  Kubernetes.
- `k8s/dev/HOW_IT_WORKS.md` — Deep dive into the local dev cluster
  architecture and service relationships.
- `k8s/dev/RESTART.md` — Safe restart procedures for stateful and stateless
  services.
- `k8s/dev/LOGS.md` — Log collection cheat sheet with `kubectl` and helper
  scripts.
- `k8s/EXTERNAL_ACCESS.md` — Port mappings and security considerations for
  exposing services outside the cluster.
- `deployment-runbook.md` — GitHub Actions pipeline summary and manual rollout
  checklist.
- `debugging-playbook.md` — Step-by-step debugging checklist (logs, Redis wipe,
  rebuild, port forwards).

## Production Notes
- `README-PROD.md` — End-to-end k3s deployment and GitHub Actions automation
  for the production backend.
- `README-JUDGE0-LIMITATION.md` — Current ARM64 limitations and mitigation
  options for Judge0.

## Environment Variables
- `ENV_VAR_AUDIT.md` — Inventory of required environment variables across the
  stack, with highlights for backend dependencies.
- `ENV_VAR_FIXES_SUMMARY.md` — Summary of code and manifest updates that remove
  hard-coded connection details.

## Feature Deep Dives
- `matchmaking-flow.md` — How the Colyseus queue pairs humans and bots,
  including Redis key map.
- `bot-lifecycle.md` — Bot service leadership, deployment rules, and recovery
  steps.
- `judge0-runbook.md` — Submission flow, failure modes, and troubleshooting
  checklist for Judge0 integration.



