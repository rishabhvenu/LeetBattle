# How to View Logs

## Quick Reference

| View Type | Command |
|-----------|---------|
| **Real-time (follow)** | `./logs.sh colyseus` |
| **Last N lines** | `./logs.sh colyseus --tail=100` |
| **Non-real-time (snapshot)** | `kubectl logs -n codeclashers-dev <pod-name>` |
| **All services** | `./logs.sh --all` |
| **Previous container** | `./logs.sh colyseus --previous` |

## Using the Logs Script

### Basic Usage

```bash
cd backend/k8s/dev

# Follow Colyseus logs in real-time
./logs.sh colyseus

# Follow bot logs
./logs.sh bots

# Follow Judge0 server logs
./logs.sh judge0

# Follow Judge0 worker logs
./logs.sh judge0-worker

# Follow MongoDB logs
./logs.sh mongodb

# Follow Redis logs
./logs.sh redis

# Follow PostgreSQL logs
./logs.sh postgres

# Follow MinIO logs
./logs.sh minio
```

Press **Ctrl+C** to stop following logs.

### View Last N Lines (Non-Real-Time)

```bash
# Show last 50 lines (default, no follow)
./logs.sh colyseus --tail=50

# Show last 100 lines
./logs.sh colyseus --tail=100

# Show last 500 lines
./logs.sh colyseus --tail=500
```

### View All Pod Logs

```bash
# Show logs from all pods (snapshot, non-real-time)
./logs.sh --all
```

This shows a snapshot of logs from all pods. Useful for getting an overview but not for real-time monitoring.

### View Previous Container Logs

If a pod restarted and you want to see logs from the previous container instance:

```bash
./logs.sh colyseus --previous
```

Useful for debugging crashes or restarts.

## Direct kubectl Commands

### Real-Time Logs (Follow)

```bash
# Follow logs from a specific pod
kubectl logs -n codeclashers-dev -f <pod-name>

# Follow logs from all pods with a label
kubectl logs -n codeclashers-dev -f -l app=colyseus

# Follow logs with timestamps
kubectl logs -n codeclashers-dev -f --timestamps -l app=colyseus

# Follow logs with pod name prefix (multiple pods)
kubectl logs -n codeclashers-dev -f -l app=colyseus --prefix
```

### Non-Real-Time Logs (Snapshot)

```bash
# Show last 50 lines (default)
kubectl logs -n codeclashers-dev <pod-name>

# Show last 100 lines
kubectl logs -n codeclashers-dev --tail=100 <pod-name>

# Show last 10 minutes of logs
kubectl logs -n codeclashers-dev --since=10m <pod-name>

# Show logs since a specific time
kubectl logs -n codeclashers-dev --since-time="2025-11-02T09:00:00Z" <pod-name>

# Show all logs from a pod (may be very long)
kubectl logs -n codeclashers-dev <pod-name> --tail=-1
```

### Find Pod Names

```bash
# List all pods
kubectl get pods -n codeclashers-dev

# Get pod name for a specific service
kubectl get pods -n codeclashers-dev -l app=colyseus -o jsonpath='{.items[0].metadata.name}'

# Get all pod names for a service
kubectl get pods -n codeclashers-dev -l app=colyseus -o name
```

## Service-Specific Examples

### Colyseus (Game Server)

```bash
# Real-time logs
./logs.sh colyseus

# Or with kubectl
kubectl logs -n codeclashers-dev -f -l app=colyseus

# Last 100 lines
kubectl logs -n codeclashers-dev --tail=100 -l app=colyseus
```

### Bots Service

```bash
# Real-time logs
./logs.sh bots

# Filter for errors only
kubectl logs -n codeclashers-dev -f -l app=bots | grep -i error
```

### Judge0 (Code Execution)

```bash
# Judge0 Server (real-time)
./logs.sh judge0

# Judge0 Worker (real-time)
./logs.sh judge0-worker

# Both at once (need two terminals)
./logs.sh judge0 &
./logs.sh judge0-worker &
```

### MongoDB (Database)

```bash
# Real-time logs
./logs.sh mongodb

# Show only connection logs
kubectl logs -n codeclashers-dev -f -l app=mongodb-dev | grep -i "connection"
```

### Redis (Cache)

```bash
# Real-time logs
./logs.sh redis

# Redis logs are usually minimal, mostly connection info
```

## Advanced Log Viewing

### Filter Logs with grep

```bash
# Follow logs and show only errors
kubectl logs -n codeclashers-dev -f -l app=colyseus | grep -i error

# Show only warnings and errors
kubectl logs -n codeclashers-dev -f -l app=colyseus | grep -E "(WARN|ERROR|error)"

# Show lines containing specific text
kubectl logs -n codeclashers-dev -f -l app=colyseus | grep "matchmaking"

# Show logs excluding certain patterns
kubectl logs -n codeclashers-dev -f -l app=colyseus | grep -v "DEBUG"
```

### Multiple Pods with Labels

```bash
# Follow logs from all backend services (Colyseus + Bots)
kubectl logs -n codeclashers-dev -f -l 'app in (colyseus,bots)' --prefix

# Follow logs from all Judge0 components
kubectl logs -n codeclashers-dev -f -l 'app in (judge0-server,judge0-worker)' --prefix
```

### Save Logs to File

```bash
# Save current logs to file
kubectl logs -n codeclashers-dev -l app=colyseus > colyseus-logs.txt

# Save real-time logs (will keep appending)
kubectl logs -n codeclashers-dev -f -l app=colyseus >> colyseus-logs.txt &

# Save with timestamps
kubectl logs -n codeclashers-dev --timestamps -l app=colyseus > colyseus-logs-timed.txt
```

### Compare Logs from Multiple Pods

```bash
# Get logs from all Colyseus pods and save separately
for pod in $(kubectl get pods -n codeclashers-dev -l app=colyseus -o jsonpath='{.items[*].metadata.name}'); do
  kubectl logs -n codeclashers-dev $pod > "logs-$pod.txt"
done
```

## Multi-Terminal Setup

Open multiple terminal windows for different services:

**Terminal 1 (Colyseus):**
```bash
cd backend/k8s/dev
./logs.sh colyseus
```

**Terminal 2 (Bots):**
```bash
cd backend/k8s/dev
./logs.sh bots
```

**Terminal 3 (Judge0):**
```bash
cd backend/k8s/dev
./logs.sh judge0
```

**Terminal 4 (All Services):**
```bash
kubectl get pods -n codeclashers-dev -w
```

## Log Analysis Tips

### Find Errors Quickly

```bash
# Show last 100 lines and filter errors
kubectl logs -n codeclashers-dev --tail=100 -l app=colyseus | grep -i error -A 5 -B 5

# Count error occurrences
kubectl logs -n codeclashers-dev -l app=colyseus | grep -i error | wc -l

# Show unique error messages
kubectl logs -n codeclashers-dev -l app=colyseus | grep -i error | sort | uniq
```

### Monitor Specific Operations

```bash
# Watch for matchmaking activity
kubectl logs -n codeclashers-dev -f -l app=colyseus | grep -i "matchmaking\|match"

# Watch for bot activity
kubectl logs -n codeclashers-dev -f -l app=bots

# Watch for code submissions
kubectl logs -n codeclashers-dev -f -l app=judge0-server | grep -i "submission"
```

### Performance Monitoring

```bash
# Show logs with timestamps to measure response times
kubectl logs -n codeclashers-dev --timestamps -l app=colyseus | grep "time"

# Count operations per minute
kubectl logs -n codeclashers-dev --since=1m -l app=colyseus | wc -l
```

## Troubleshooting Log Issues

### No Logs Appearing

**Check:**
1. Pod is running: `kubectl get pods -n codeclashers-dev`
2. Pod has logs: `kubectl logs -n codeclashers-dev <pod-name> --tail=1`
3. Container name (if multi-container pod): `kubectl logs -n codeclashers-dev <pod-name> -c <container-name>`

### Logs Cut Off

```bash
# Increase tail size
kubectl logs -n codeclashers-dev --tail=1000 -l app=colyseus

# Get all logs (may be very large)
kubectl logs -n codeclashers-dev <pod-name> --tail=-1
```

### Previous Container Logs Not Available

If `--previous` doesn't work, the pod might not have restarted recently. Check:

```bash
# See pod restart count
kubectl get pods -n codeclashers-dev

# If restartCount is 0, --previous won't work
```

### Logs Are Too Verbose

```bash
# Filter to only show important messages
kubectl logs -n codeclashers-dev -f -l app=colyseus | grep -v "DEBUG\|TRACE"

# Show only errors and warnings
kubectl logs -n codeclashers-dev -f -l app=colyseus | grep -E "(ERROR|WARN|error|warn)"
```

## Common Log Patterns

### Colyseus Logs
- `🔄 Running matchmaking cycle...` - Matchmaking activity
- `✅ Match created` - Successful match
- `❌ Error:` - Errors

### Judge0 Logs
- `Processing submission` - Code execution started
- `Submission completed` - Execution finished

### MongoDB Logs
- `Connection ended` - Normal connection close
- `DBPathInUse` - Volume lock conflict (restart issue)

### Redis Logs
- Usually minimal, mostly connection info

## Quick Commands Cheat Sheet

```bash
# Real-time: All services
./logs.sh --all

# Real-time: Specific service
./logs.sh <service>

# Snapshot: Last 100 lines
kubectl logs -n codeclashers-dev --tail=100 -l app=<service>

# Real-time: With filtering
kubectl logs -n codeclashers-dev -f -l app=<service> | grep <pattern>

# Real-time: All pods with prefix
kubectl logs -n codeclashers-dev -f --all-containers=true --prefix

# Previous container
./logs.sh <service> --previous
```






