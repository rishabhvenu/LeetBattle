# External Access to Services

After deployment, you can access services from outside the VM using the VM's public IP address and the configured ports.

## Service Access

| Service | Port | Connection String / URL |
|---------|------|------------------------|
| **MongoDB** | 27017 | `mongodb://admin:password@<VM_IP>:27017/codeclashers?replicaSet=rs0&authSource=admin` |
| **Redis** | 6379 | `redis://<VM_IP>:6379` (with password) |
| **Colyseus** | 2567 | `ws://<VM_IP>:2567` or `http://<VM_IP>:2567` |
| **Judge0** | 2358 | `http://<VM_IP>:2358` |
| **Grafana** | 3000 | `http://<VM_IP>:3000` |
| **Prometheus** | 9090 | `http://<VM_IP>:9090` |

## Finding Your VM IP

```bash
# From the VM itself
curl ifconfig.me

# Or check Oracle Cloud Console
# Oracle Cloud Console -> Compute -> Instances -> Your Instance -> Public IP
```

## Connection Examples

### MongoDB (from external application)
```bash
# Using mongosh
mongosh "mongodb://admin:password@<VM_IP>:27017/codeclashers?replicaSet=rs0&authSource=admin"

# Connection string for applications
MONGODB_URI="mongodb://admin:password@<VM_IP>:27017/codeclashers?replicaSet=rs0&authSource=admin"
```

### Redis (from external application)
```bash
# Using redis-cli
redis-cli -h <VM_IP> -p 6379 -a <REDIS_PASSWORD>

# Connection string for applications (ioredis)
REDIS_HOST=<VM_IP>
REDIS_PORT=6379
REDIS_PASSWORD=<REDIS_PASSWORD>
```

### Colyseus WebSocket
```javascript
// Client-side connection
const client = new Client('ws://<VM_IP>:2567');
```

### Judge0 API
```bash
# Test endpoint
curl http://<VM_IP>:2358/

# Submit code
curl -X POST http://<VM_IP>:2358/submissions \
  -H "Content-Type: application/json" \
  -d '{"source_code": "print(42)", "language_id": 71}'
```

### Grafana Monitoring Dashboard
```bash
# Access Grafana in browser
http://<VM_IP>:3000

# Login credentials (from app-secrets)
# Username: admin (or value from GRAFANA_ADMIN_USER)
# Password: <value from GRAFANA_ADMIN_PASSWORD>
```

### Prometheus Metrics
```bash
# Access Prometheus UI in browser
http://<VM_IP>:9090

# Query metrics via API
curl http://<VM_IP>:9090/api/v1/query?query=up
```

## Security Considerations

⚠️ **Important**: These services are exposed directly on standard ports. Ensure you:

1. **Use strong passwords** (set in GitHub Secrets)
2. **Configure firewall rules** in Oracle Cloud:
   - Security List: Allow inbound traffic on ports 27017, 6379, 2567, 2358, 3000, 9090 only from trusted IPs
   - Or use Oracle Cloud Network Security Groups to restrict access
3. **Enable MongoDB authentication** (already configured)
4. **Enable Redis password authentication** (already configured)
5. **Secure Grafana access** (credentials in app-secrets, change default password)
6. **Limit Prometheus access** (read-only by default, but consider restricting to trusted IPs)

### Recommended Firewall Setup

```bash
# On the VM, restrict access if needed
sudo ufw allow from <YOUR_IP> to any port 27017
sudo ufw allow from <YOUR_IP> to any port 6379
sudo ufw allow from <YOUR_IP> to any port 2567
sudo ufw allow from <YOUR_IP> to any port 2358
sudo ufw allow from <YOUR_IP> to any port 3000  # Grafana
sudo ufw allow from <YOUR_IP> to any port 9090  # Prometheus
```

Or configure in Oracle Cloud Console:
- Navigate to: **Networking** → **Virtual Cloud Networks** → **Your VCN** → **Security Lists**
- Edit ingress rules to restrict access to specific source IPs

## Internal Service Access

Services can also access each other internally using Kubernetes service names:

- MongoDB: `mongodb.codeclashers.svc.cluster.local:27017`
- Redis: `redis-cluster.codeclashers.svc.cluster.local:6379`
- Colyseus: `colyseus.codeclashers.svc.cluster.local:2567`
- Judge0: `judge0-server.codeclashers.svc.cluster.local:2358`
- Grafana: `grafana.codeclashers.svc.cluster.local:3000`
- Prometheus: `prometheus.codeclashers.svc.cluster.local:9090`

These internal DNS names are automatically resolved by Kubernetes and don't require the VM's public IP.

## Troubleshooting

### Check if services are exposed:
```bash
k3s kubectl get svc -n codeclashers
```

You should see NodePort services with EXTERNAL-IP showing `<VM_IP>` or `<pending>`.

### Check if ports are listening:
```bash
sudo netstat -tlnp | grep -E '27017|6379|2567|2358|3000|9090'
```

### Test connectivity:
```bash
# From external machine
telnet <VM_IP> 27017
telnet <VM_IP> 6379
telnet <VM_IP> 2567
telnet <VM_IP> 2358
telnet <VM_IP> 3000  # Grafana
telnet <VM_IP> 9090  # Prometheus
```

If connections fail:
1. Check Oracle Cloud Security List rules
2. Check if k3s installed with custom NodePort range enabled
3. Verify services are running: `k3s kubectl get pods -n codeclashers`

