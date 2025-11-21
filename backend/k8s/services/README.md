# Service Port Configuration

All service ports are configured to match the ports defined in `app-secrets`. 

## Port Mapping

Services use NodePort with the same port number as defined in secrets:

| Service | Secret Key | Default Port | Service NodePort |
|---------|-----------|--------------|------------------|
| MongoDB | `MONGODB_PORT` | 27017 | 27017 |
| Redis | `REDIS_PORT` | 6379 | 6379 |
| Colyseus | `COLYSEUS_PORT` | 2567 | 2567 |
| Judge0 | `JUDGE0_PORT` | 2358 | 2358 |

## Important Notes

⚠️ **Port Synchronization**: When you change port values in GitHub Variables/Secrets, you must also update the corresponding service YAML files to match:

- `services/mongodb/service.yaml` - `nodePort` should match `MONGODB_PORT` secret
- `services/redis-cluster-service.yaml` - `nodePort` should match `REDIS_PORT` secret  
- `services/colyseus-service.yaml` - `nodePort` should match `COLYSEUS_PORT` secret
- `services/judge0-server-service.yaml` - `nodePort` should match `JUDGE0_PORT` secret

The application containers read port values from secrets via environment variables, but Kubernetes services require static port definitions in YAML.

## Dynamic Port Configuration (Future Improvement)

For truly dynamic ports, consider using:
- Helm charts with templating
- Kustomize patches
- Operator pattern with custom controllers

